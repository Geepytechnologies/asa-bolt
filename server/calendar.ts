import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Booking } from "../shared/contracts.js";
import type { CalendarChoice, CalendarOverview, CalendarUpdate } from "../shared/calendar.js";
import { CALENDAR_STATES } from "../shared/calendar.js";
import { BRAND_CONFIG } from "../shared/config.js";
import { agreedFareAmount } from "../shared/booking-pricing.js";
import { HttpError } from "./errors.js";
import type { Database } from "./infrastructure/database.js";
import type { Repository } from "./infrastructure/repository.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
const API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Row = Record<string, unknown>;
interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
interface EventBody {
  summary: string;
  description: string;
  location: string;
  status: "confirmed" | "cancelled";
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  endTimeUnspecified: true;
  transparency: "transparent";
  visibility: "private";
  reminders: { useDefault: false };
  extendedProperties: { private: { asaBookingId: string } };
}

/** All credentials and transport calls stay on the server. Booking transactions only enqueue work. */
export class GoogleCalendar {
  private processing = false;
  private refreshing?: Promise<Tokens>;
  readonly callbackUrl: string;
  constructor(
    private readonly database: Database,
    private readonly repository: Repository,
    private readonly env: NodeJS.ProcessEnv,
    private readonly appOrigin: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.callbackUrl = `${appOrigin}/api/calendar/google/callback`;
    database.connection.exec("INSERT OR IGNORE INTO calendar_connection (id) VALUES (1)");
  }

  private connection(): Row {
    return this.database.connection
      .prepare("SELECT * FROM calendar_connection WHERE id = 1")
      .get()!;
  }
  private missing(): string[] {
    return [
      ...(!this.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ? ["GOOGLE_CALENDAR_CLIENT_ID"] : []),
      ...(!this.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ? ["GOOGLE_CALENDAR_CLIENT_SECRET"] : []),
      ...(!/^[a-f0-9]{64}$/i.test(this.env.ASA_BOLT_CALENDAR_TOKEN_KEY ?? "")
        ? ["ASA_BOLT_CALENDAR_TOKEN_KEY (64 hexadecimal characters)"]
        : []),
    ];
  }
  private requireConfigured(): void {
    if (this.missing().length)
      throw new HttpError(
        409,
        "Google Calendar is not configured. Add the server credentials first.",
      );
  }
  private encrypt(value: string): string {
    this.requireConfigured();
    const iv = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(this.env.ASA_BOLT_CALENDAR_TOKEN_KEY!, "hex"),
        iv,
      );
    cipher.setAAD(Buffer.from("asa-google-calendar-v1"));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((value) => value.toString("base64url"))
      .join(".");
  }
  private decrypt(value: string): string {
    this.requireConfigured();
    try {
      const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part, "base64url"));
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(this.env.ASA_BOLT_CALENDAR_TOKEN_KEY!, "hex"),
        iv,
      );
      decipher.setAAD(Buffer.from("asa-google-calendar-v1"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new HttpError(
        409,
        "Stored calendar credentials cannot be unlocked. Restore the original token key or reconnect Google.",
      );
    }
  }
  private tokens(): Tokens {
    const row = this.connection();
    if (!row.credentials || row.client_hash !== hash(this.env.GOOGLE_CALENDAR_CLIENT_ID ?? ""))
      throw new HttpError(409, "Connect or reconnect Google Calendar before syncing rides.");
    return JSON.parse(this.decrypt(String(row.credentials))) as Tokens;
  }
  private isConnected(): boolean {
    try {
      this.tokens();
      return true;
    } catch {
      return false;
    }
  }
  overview(search = ""): CalendarOverview {
    this.recover();
    const row = this.connection(),
      missing = this.missing(),
      connected = this.isConnected();
    const ready = connected && Boolean(row.calendar_id);
    const updates = this.database.connection
      .prepare(
        "SELECT * FROM calendar_updates WHERE instr(lower(reference), lower(?)) > 0 ORDER BY updated_at DESC, rowid DESC LIMIT 100",
      )
      .all(search.trim().slice(0, 80))
      .map((r) => this.publicUpdate(r, ready));
    const counts = Object.fromEntries(
      CALENDAR_STATES.map((s) => [s, 0]),
    ) as CalendarOverview["counts"];
    for (const count of this.database.connection
      .prepare("SELECT status, COUNT(*) AS n FROM calendar_updates GROUP BY status")
      .all())
      counts[count.status as keyof typeof counts] = Number(count.n);
    return {
      configured: missing.length === 0,
      missing,
      connected,
      ready,
      account: String(row.account_id),
      calendarId: String(row.calendar_id),
      calendarName: String(row.calendar_name),
      revision: Number(row.revision),
      lastCheckedAt: row.checked_at == null ? null : String(row.checked_at),
      lastError:
        String(row.last_error) ||
        (row.credentials && !connected && !missing.length
          ? "Reconnect Google or check the token encryption key."
          : ""),
      callbackUrl: this.callbackUrl,
      updates,
      counts,
    };
  }
  private publicUpdate(row: Row, ready: boolean): CalendarUpdate {
    return {
      bookingId: String(row.booking_id),
      reference: String(row.reference),
      eventId: String(row.event_id),
      calendarId: String(row.calendar_id),
      status: row.status as CalendarUpdate["status"],
      revision: Number(row.revision),
      attempts: Number(row.attempts),
      lastError: String(row.last_error),
      updatedAt: String(row.updated_at),
      retryable: ready && row.status === "failed" && !row.lease_until,
    };
  }

  startAuthorization(session: string): string {
    this.requireConfigured();
    const db = this.database.connection;
    db.prepare("DELETE FROM calendar_oauth_states WHERE expires_at <= ? OR session_hash = ?").run(
      Date.now(),
      hash(session),
    );
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(48).toString("base64url");
    db.prepare("INSERT INTO calendar_oauth_states VALUES (?, ?, ?, ?, ?)").run(
      hash(state),
      hash(session),
      this.encrypt(verifier),
      Date.now() + 10 * 60_000,
      Number(this.connection().revision),
    );
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_CALENDAR_CLIENT_ID!,
      redirect_uri: this.callbackUrl,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    return url.href;
  }
  async completeAuthorization(
    params: URLSearchParams,
    activeSession: (sessionHash: string) => boolean,
  ): Promise<void> {
    this.requireConfigured();
    const state = params.get("state") ?? "";
    if (!/^[a-f0-9]{64}$/.test(state))
      throw new HttpError(401, "Invalid or expired calendar connection request.");
    const row = this.database.connection
      .prepare("DELETE FROM calendar_oauth_states WHERE state_hash = ? RETURNING *")
      .get(hash(state));
    if (
      !row ||
      Number(row.expires_at) <= Date.now() ||
      !activeSession(String(row.session_hash)) ||
      Number(row.connection_revision) !== Number(this.connection().revision)
    )
      throw new HttpError(
        401,
        "The calendar connection request expired. Sign in and connect again.",
      );
    const code = params.get("code");
    if (params.has("error") || !code || code.length > 4096)
      throw new HttpError(400, "Google Calendar access was not granted. Try connecting again.");
    const tokens = await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.callbackUrl,
      code_verifier: this.decrypt(String(row.verifier)),
    });
    const calendars = await this.readCalendars(tokens.accessToken);
    const account = calendars.find((c) => c.primary)?.id;
    if (!account)
      throw new HttpError(
        409,
        "Google did not return a writable primary calendar. Connect the intended Google account again.",
      );
    const current = this.connection();
    if (Number(current.revision) !== Number(row.connection_revision))
      throw new HttpError(409, "Calendar settings changed. Connect again.");
    const frozen = this.database.connection
      .prepare("SELECT booking_id FROM calendar_updates WHERE calendar_id != '' LIMIT 1")
      .get();
    if (frozen && current.account_id !== account)
      throw new HttpError(
        409,
        "Existing ride events belong to another Google account. Reconnect the original account to update them safely.",
      );
    const selected =
      current.account_id === account && calendars.find((c) => c.id === current.calendar_id);
    this.database.connection
      .prepare(
        "UPDATE calendar_connection SET account_id=?, calendar_id=?, calendar_name=?, credentials=?, client_hash=?, revision=revision+1, checked_at=?, last_error='' WHERE id=1",
      )
      .run(
        account,
        selected ? selected.id : "",
        selected ? selected.name : "",
        this.encrypt(JSON.stringify(tokens)),
        hash(this.env.GOOGLE_CALENDAR_CLIENT_ID!),
        new Date().toISOString(),
      );
  }

  private async exchange(values: Record<string, string>): Promise<Tokens> {
    const response = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CALENDAR_CLIENT_ID!,
        client_secret: this.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
        ...values,
      }),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        "Google authorization failed. Check the server credentials or reconnect the calendar.",
      );
    const data = await this.json(response);
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.expires_in !== "number" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      (values.grant_type === "authorization_code" &&
        (typeof data.refresh_token !== "string" || !data.refresh_token))
    )
      throw new HttpError(
        502,
        "Google did not grant offline calendar access. Reconnect and approve the requested access.",
      );
    if (
      typeof data.scope === "string" &&
      SCOPES.some((scope) => !String(data.scope).split(" ").includes(scope))
    )
      throw new HttpError(
        403,
        "Google did not grant all required calendar permissions. Reconnect and approve calendar access.",
      );
    return {
      accessToken: data.access_token,
      refreshToken:
        typeof data.refresh_token === "string" ? data.refresh_token : values.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
  private async accessToken(): Promise<string> {
    const tokens = this.tokens();
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    if (!this.refreshing) {
      const revision = Number(this.connection().revision);
      this.refreshing = this.exchange({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      })
        .then((fresh) => {
          if (revision !== Number(this.connection().revision))
            throw new HttpError(
              409,
              "Calendar connection changed during token refresh. Try again.",
            );
          this.database.connection
            .prepare("UPDATE calendar_connection SET credentials=? WHERE id=1 AND revision=?")
            .run(this.encrypt(JSON.stringify(fresh)), revision);
          return fresh;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return (await this.refreshing).accessToken;
  }
  private async readCalendars(token: string): Promise<CalendarChoice[]> {
    const calendars: CalendarChoice[] = [];
    let pageToken = "";
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${API}/users/me/calendarList`);
      url.search = new URLSearchParams({
        minAccessRole: "writer",
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const response = await this.fetch(url.href, {
        headers: { Authorization: `Bearer ${token}` },
      });
      this.checkResponse(response);
      const data = await this.json(response);
      if (!Array.isArray(data.items))
        throw new HttpError(502, "Google returned an invalid calendar list.");
      for (const item of data.items as Row[])
        if (typeof item.id === "string" && ["owner", "writer"].includes(String(item.accessRole)))
          calendars.push({
            id: item.id,
            name: String(item.summaryOverride ?? item.summary ?? item.id),
            primary: item.primary === true,
          });
      pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
      if (!pageToken) return calendars;
    }
    throw new HttpError(
      502,
      "The calendar list is too large. Use an account with fewer calendars.",
    );
  }
  async calendars(): Promise<CalendarChoice[]> {
    const revision = Number(this.connection().revision);
    try {
      const calendars = await this.readCalendars(await this.accessToken());
      if (Number(this.connection().revision) !== revision)
        throw new HttpError(409, "Calendar connection changed. Refresh before continuing.");
      this.database.connection
        .prepare(
          "UPDATE calendar_connection SET checked_at=?, last_error='' WHERE id=1 AND revision=?",
        )
        .run(new Date().toISOString(), revision);
      return calendars;
    } catch (error) {
      this.noteConnectionError(error, revision);
      throw error;
    }
  }
  async selectCalendar(id: string, expectedRevision: number): Promise<void> {
    if (expectedRevision !== Number(this.connection().revision))
      throw new HttpError(409, "Calendar settings changed. Refresh before choosing.");
    const calendar = (await this.calendars()).find((c) => c.id === id);
    if (!calendar)
      throw new HttpError(400, "Choose a writable calendar from the connected Google account.");
    if (expectedRevision !== Number(this.connection().revision))
      throw new HttpError(409, "Calendar settings changed. Refresh before choosing.");
    const frozen = this.database.connection
      .prepare(
        "SELECT booking_id FROM calendar_updates WHERE calendar_id != '' AND calendar_id != ? LIMIT 1",
      )
      .get(id);
    if (frozen)
      throw new HttpError(
        409,
        "Ride events already use another calendar. Keep that calendar so updates reach the same events.",
      );
    this.database.connection
      .prepare(
        "UPDATE calendar_connection SET calendar_id=?, calendar_name=?, revision=revision+1 WHERE id=1",
      )
      .run(calendar.id, calendar.name);
    this.reconcileUpcoming();
  }
  async disconnect(expectedRevision: number): Promise<void> {
    const connection = this.connection();
    if (expectedRevision !== Number(connection.revision))
      throw new HttpError(409, "Calendar settings changed. Refresh before disconnecting.");
    let refreshToken = "";
    try {
      refreshToken = this.tokens().refreshToken;
    } catch {
      /* Clearing unreadable credentials is still permitted. */
    }
    this.database.connection
      .prepare(
        "UPDATE calendar_connection SET credentials='', revision=revision+1, last_error='' WHERE id=1",
      )
      .run();
    this.database.connection.exec("DELETE FROM calendar_oauth_states");
    if (refreshToken) {
      try {
        const response = await this.fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }),
        });
        if (!response.ok) throw new Error();
      } catch {
        this.database.connection
          .prepare("UPDATE calendar_connection SET last_error=? WHERE id=1 AND revision=?")
          .run(
            "Disconnected locally. Google revocation could not be verified; remove app access in your Google account if needed.",
            expectedRevision + 1,
          );
      }
    }
  }

  queueBooking(booking: Booking): void {
    const accepted = booking.events.some((event) => event.toStatus === "confirmed");
    if (booking.status !== "confirmed" && !(booking.status === "cancelled" && accepted)) return;
    const body = this.eventBody(booking),
      desired = JSON.stringify(body),
      db = this.database.connection;
    const existing = db
      .prepare("SELECT desired_json FROM calendar_updates WHERE booking_id=?")
      .get(booking.id);
    if (existing?.desired_json === desired) return;
    const waiting = !this.isConnected() || !this.connection().calendar_id;
    db.prepare(
      "INSERT INTO calendar_updates (booking_id, reference, event_id, desired_json, status, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(booking_id) DO UPDATE SET desired_json=excluded.desired_json, revision=calendar_updates.revision+1, status=excluded.status, last_error='', updated_at=excluded.updated_at",
    ).run(
      booking.id,
      booking.reference,
      `asa${hash(booking.id)}`,
      desired,
      waiting ? "awaiting_setup" : "queued",
      new Date().toISOString(),
    );
  }
  reconcileUpcoming(): void {
    const rows = this.database.connection
      .prepare(
        "SELECT id FROM bookings WHERE status='confirmed' AND julianday(pickup_at)>=julianday(?) AND id NOT IN (SELECT booking_id FROM calendar_updates)",
      )
      .all(new Date().toISOString());
    for (const row of rows) {
      const booking = this.repository.findBookingById(String(row.id));
      if (booking) this.queueBooking(this.repository.toBooking(booking));
    }
  }
  private eventBody(booking: Booking): EventBody {
    const fare = agreedFareAmount(booking);
    const price =
      fare === undefined
        ? ""
        : `Agreed fare: ${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(fare / 100)}\n`;
    return {
      summary: `${BRAND_CONFIG.name} ${booking.reference} · ${booking.origin.name} → ${booking.destination.name}`,
      description:
        `${booking.reference}\n${price}${booking.status === "cancelled" ? `Cancelled: ${booking.cancellationReason}\n` : ""}Pickup marker only; ride duration is not estimated. Manage this ride in the admin portal: ${this.appOrigin}/admin`
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;"),
      location: booking.origin.name,
      status: booking.status === "cancelled" ? "cancelled" : "confirmed",
      start: { dateTime: booking.pickupAt, timeZone: BRAND_CONFIG.timezone },
      // Google requires an end value even when endTimeUnspecified is true. This is API compatibility, not a ride slot.
      end: {
        dateTime: new Date(Date.parse(booking.pickupAt) + 60_000).toISOString(),
        timeZone: BRAND_CONFIG.timezone,
      },
      endTimeUnspecified: true,
      transparency: "transparent",
      visibility: "private",
      reminders: { useDefault: false },
      extendedProperties: { private: { asaBookingId: booking.id } },
    };
  }
  private recover(): void {
    this.database.connection
      .prepare(
        "UPDATE calendar_updates SET status=CASE WHEN status='syncing' THEN 'failed' ELSE status END, last_error=CASE WHEN status='syncing' THEN 'An update was interrupted. Retry to reconcile the saved event ID.' ELSE last_error END, lease_until=NULL WHERE lease_until <= ?",
      )
      .run(Date.now());
  }
  retry(id: string, revision: number): void {
    this.recover();
    if (!this.overview().ready)
      throw new HttpError(409, "Connect Google and choose a calendar before retrying.");
    const row = this.database.connection
      .prepare("SELECT * FROM calendar_updates WHERE booking_id=?")
      .get(id);
    if (!row) throw new HttpError(404, "Calendar update not found.");
    if (Number(row.revision) !== revision)
      throw new HttpError(409, "This ride changed. Refresh before retrying its latest update.");
    if (row.status !== "failed" || row.lease_until)
      throw new HttpError(409, "Only a failed calendar update can be retried.");
    this.database.connection
      .prepare(
        "UPDATE calendar_updates SET status='queued', last_error='', updated_at=? WHERE booking_id=? AND revision=?",
      )
      .run(new Date().toISOString(), id, revision);
  }
  async processQueued(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      this.recover();
      if (!this.isConnected() || !this.connection().calendar_id) return;
      const rows = this.database.connection
        .prepare(
          "SELECT * FROM calendar_updates WHERE status IN ('queued','awaiting_setup') AND lease_until IS NULL ORDER BY updated_at LIMIT 5",
        )
        .all();
      for (const row of rows) {
        if (!this.isConnected() || !this.connection().calendar_id) break;
        await this.sync(row);
      }
    } finally {
      this.processing = false;
    }
  }
  private async sync(row: Row): Promise<void> {
    const connection = this.connection(),
      db = this.database.connection;
    const epoch = Number(connection.revision),
      revision = Number(row.revision);
    const claimed = db
      .prepare(
        "UPDATE calendar_updates SET status='syncing', attempts=attempts+1, lease_until=?, calendar_id=CASE WHEN calendar_id='' THEN ? ELSE calendar_id END, account_id=CASE WHEN account_id='' THEN ? ELSE account_id END WHERE booking_id=? AND revision=? AND lease_until IS NULL AND status IN ('queued','awaiting_setup')",
      )
      .run(
        Date.now() + 60_000,
        String(connection.calendar_id),
        String(connection.account_id),
        String(row.booking_id),
        revision,
      );
    if (!claimed.changes) return;
    const job = db
      .prepare("SELECT * FROM calendar_updates WHERE booking_id=?")
      .get(String(row.booking_id))!;
    try {
      if (job.calendar_id !== connection.calendar_id || job.account_id !== connection.account_id)
        throw new HttpError(
          409,
          "This ride belongs to another calendar connection. Reconnect its original account and calendar.",
        );
      const token = await this.accessToken();
      const path = `${API}/calendars/${encodeURIComponent(String(job.calendar_id))}/events`;
      const eventUrl = `${path}/${encodeURIComponent(String(job.event_id))}`;
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const existing = await this.fetch(eventUrl, { headers });
      const body = JSON.parse(String(job.desired_json)) as EventBody;
      if (
        epoch !== Number(this.connection().revision) ||
        revision !==
          Number(
            db
              .prepare("SELECT revision FROM calendar_updates WHERE booking_id=?")
              .get(String(job.booking_id))?.revision,
          )
      )
        throw new HttpError(
          409,
          "Calendar or ride changed during sync. The latest update will be processed next.",
        );
      if ([404, 410].includes(existing.status)) {
        if (body.status !== "cancelled") {
          const created = await this.fetch(`${path}?sendUpdates=none`, {
            method: "POST",
            headers,
            body: JSON.stringify({ id: job.event_id, ...body }),
          });
          if (created.status === 409)
            throw new HttpError(
              409,
              "Google already has this event ID. Retry to reconcile it without creating another event.",
            );
          await this.verifyWrite(created, String(job.event_id));
        }
      } else {
        this.checkResponse(existing);
        const event = await this.json(existing);
        if (event.id !== String(job.event_id))
          throw new HttpError(502, "Google returned an unexpected event ID. No changes were made.");
        if (event.status === "cancelled" && body.status !== "cancelled")
          throw new HttpError(
            409,
            "The event was deleted in Google Calendar. Restore it there before retrying this update.",
          );
        if (
          event.status !== "cancelled" &&
          (event.extendedProperties as { private?: { asaBookingId?: string } } | undefined)?.private
            ?.asaBookingId !== String(job.booking_id)
        )
          throw new HttpError(
            409,
            "The saved Google event does not belong to this ride. No changes were made.",
          );
        if (event.status !== "cancelled") {
          const updated = await this.fetch(`${eventUrl}?sendUpdates=none`, {
            method: "PATCH",
            headers: {
              ...headers,
              ...(typeof event.etag === "string" ? { "If-Match": event.etag } : {}),
            },
            body: JSON.stringify(body),
          });
          await this.verifyWrite(updated, String(job.event_id));
        }
      }
      db.prepare(
        "UPDATE calendar_updates SET status=?, lease_until=NULL, last_error='', updated_at=? WHERE booking_id=? AND revision=?",
      ).run(
        body.status === "cancelled" ? "cancelled" : "synced",
        new Date().toISOString(),
        String(job.booking_id),
        revision,
      );
    } catch (error) {
      db.prepare(
        "UPDATE calendar_updates SET status='failed', lease_until=NULL, last_error=?, updated_at=? WHERE booking_id=? AND revision=?",
      ).run(safeError(error), new Date().toISOString(), String(job.booking_id), revision);
      if (error instanceof HttpError && error.status === 401)
        this.noteConnectionError(error, epoch);
    } finally {
      // A newer accepted/rescheduled/cancelled snapshot wins over any response for an older revision.
      db.prepare(
        "UPDATE calendar_updates SET lease_until=NULL WHERE booking_id=? AND revision != ?",
      ).run(String(job.booking_id), revision);
    }
  }
  private noteConnectionError(error: unknown, revision: number): void {
    this.database.connection
      .prepare("UPDATE calendar_connection SET last_error=? WHERE id=1 AND revision=?")
      .run(safeError(error), revision);
  }
  private async verifyWrite(response: Response, expectedId: string): Promise<void> {
    this.checkResponse(response);
    if ((await this.json(response)).id !== expectedId)
      throw new HttpError(
        502,
        "Google did not confirm the saved event ID. Retry to reconcile the same event.",
      );
  }
  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.request(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new HttpError(
        502,
        "Google could not be reached or its response was lost. Retry to reconcile the same saved event ID.",
      );
    }
  }
  private checkResponse(response: Response): void {
    if (response.ok) return;
    if (response.status === 401)
      throw new HttpError(
        401,
        "Google authorization expired or was revoked. Reconnect the calendar and retry.",
      );
    if (response.status === 403)
      throw new HttpError(
        403,
        "Google denied calendar access or quota. Check calendar permissions and API setup, then retry.",
      );
    throw new HttpError(
      502,
      `Google Calendar returned HTTP ${response.status}. The ride remains saved; retry its latest calendar update.`,
    );
  }
  private async json(response: Response): Promise<Row> {
    try {
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error();
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      return data as Row;
    } catch {
      throw new HttpError(502, "Google returned an invalid response. Retry the saved update.");
    }
  }
}
function safeError(error: unknown): string {
  return error instanceof HttpError
    ? error.message
    : "Calendar update failed. The ride remains saved; refresh and retry.";
}
