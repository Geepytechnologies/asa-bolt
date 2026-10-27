import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BRAND_CONFIG } from "../../../shared/config.js";
import { agreedFareAmount } from "../../../shared/booking-pricing.js";
import type { Booking } from "../../../shared/contracts.js";
import type { NotificationResult } from "./index.js";
import type { Database } from "../database.js";
import { EmailStore, type StoredEmail } from "./store.js";
import { HttpError } from "../../errors.js";
import { normalizeEmail } from "../../domain/rules.js";
import { verifyResendEvent } from "./resend.js";
import type { IncomingHttpHeaders } from "node:http";
import {
  EMAIL_EVENTS,
  EMAIL_STATES,
  type EmailConnection,
  type EmailDelivery,
  type EmailDeliveryDetail,
  type EmailEvent,
  type EmailState,
  type NotificationOverview,
} from "../../../shared/notifications.js";

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export class CustomerEmail {
  readonly appOrigin: string;
  readonly store: EmailStore;
  private readonly activeSends = new Map<string, Promise<StoredEmail>>();
  private nextResendSlot: Promise<void> = Promise.resolve();

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    database: Database,
    private readonly sendRequest: typeof fetch = fetch,
    readonly channel: "email" | "whatsapp" = "email",
  ) {
    this.store = new EmailStore(
      database,
      channel === "whatsapp"
        ? ""
        : (env.ASA_BOLT_OWNER_NOTIFICATION_EMAIL ?? env.ASA_BOLT_OWNER_EMAIL ?? ""),
      channel,
    );
    const configured = env.ASA_BOLT_PUBLIC_APP_URL;
    if (env.NODE_ENV === "production" && !configured) {
      throw new Error("ASA_BOLT_PUBLIC_APP_URL is required in production.");
    }
    const url = new URL(configured ?? "http://localhost:5173");
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    ) {
      throw new Error(
        "Use an exact HTTPS public app origin without a path, query or fragment (HTTP localhost is allowed in development).",
      );
    }
    this.appOrigin = url.origin;
  }

  async sendHistoryLink(email: string, token: string): Promise<NotificationResult> {
    const message = {
      to: email,
      subject: `Your private ${BRAND_CONFIG.name} request history`,
      text: `Open your requests: ${this.appOrigin}/my-requests#token=${token}\n\nThis private link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`,
    };
    // Keep verification tokens out of persistent delivery records and admin responses.
    const record = this.store.queue({
      occurrence: randomUUID(),
      bookingId: null,
      reference: "",
      event: "history.link",
      audience: "customer",
      recipient: email,
      subject: message.subject,
      text: "",
      enabled: true,
    });
    return resultFor(await this.perform(record, "system", message.text));
  }

  async sendBooking(
    booking: Booking,
    event: "request.received" | "request.updated" | "request.rescheduled",
  ): Promise<NotificationResult[]> {
    const records = this.queueBooking(booking, event);
    return Promise.all(
      records.map(async (record) =>
        resultFor(
          record.status === "queued" && record.attempts === 0
            ? await this.perform(record, "system")
            : record,
        ),
      ),
    );
  }

  queueBooking(
    booking: Booking,
    event: "request.received" | "request.updated" | "request.rescheduled",
  ): StoredEmail[] {
    const status =
      booking.status === "requested"
        ? "Pending approval"
        : booking.status === "confirmed"
          ? "Accepted"
          : booking.status.replaceAll("_", " ");
    const currency = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    });
    const formatFare = (amount: number) => currency.format(amount / 100);
    const agreed = agreedFareAmount(booking);
    const prices = [
      `Quoted fare: ${formatFare(booking.fare.amountKobo)}`,
      ...(booking.offer
        ? [
            `Proposed fare: ${formatFare(booking.offer.roundedAmountKobo)} (entered ₦${booking.offer.amountNaira}, rounded up in ₦50 steps)`,
            ...(booking.offer.note ? [`Offer note: ${booking.offer.note}`] : []),
          ]
        : []),
      ...(agreed !== undefined ? [`Agreed fare: ${formatFare(agreed)}`] : []),
    ].join("\n");
    const time = new Intl.DateTimeFormat("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    }).format(new Date(booking.pickupAt));
    const change = event === "request.rescheduled" ? booking.scheduleEvents?.at(-1) : undefined;
    const changeText = change
      ? `Pickup changed from ${new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(change.fromPickupAt))} to ${time} (Africa/Lagos).\nReason: ${change.reason}\nYour saved fare and approval status are unchanged.\n`
      : "";
    const reason = booking.rejectionReason || booking.cancellationReason;
    const text = `${booking.reference}: ${event === "request.rescheduled" ? "Rescheduled · " : ""}${status}\n${changeText}${booking.origin.name} → ${booking.destination.name}\nPickup: ${time} (Africa/Lagos)\n${prices}\n${reason ? `Reason: ${reason}\n` : ""}Details: ${this.appOrigin}/status/${encodeURIComponent(booking.accessToken)}\n\n${booking.status === "requested" ? (booking.offer ? "Your one offer is awaiting an admin decision. Your ride is confirmed at the proposed fare only if the admin accepts it.\n" : "Your ride is not confirmed until the admin accepts it.\n") : ""}${booking.status === "rejected" ? `No fare was agreed. Make a new request: ${this.appOrigin}/\n` : ""}${booking.status === "requested" ? "If unanswered at pickup time, this request is automatically rejected.\n" : ""}Request a private history link: ${this.appOrigin}/my-requests`;
    const notificationEvent: EmailEvent =
      event === "request.updated"
        ? (
            {
              confirmed: "request.accepted",
              rejected: "request.rejected",
              cancelled: "request.cancelled",
              picked_up: "ride.picked_up",
              arrived: "ride.arrived",
              completed: "ride.completed",
              requested: "request.received",
            } as const
          )[booking.status]
        : event;
    const settings = this.store.settings();
    const rule = settings.events[notificationEvent];
    const occurrence = `${booking.id}:${notificationEvent}:${event === "request.rescheduled" ? change?.id : booking.status}`;
    const customerRecipient =
      this.channel === "email"
        ? booking.email
        : booking.whatsappConsentAt && !booking.whatsappOptOutAt
          ? booking.whatsappNumber
          : undefined;
    const recipients = [
      ...new Set(
        [customerRecipient, ...settings.adminRecipients].filter((value): value is string =>
          Boolean(value),
        ),
      ),
    ];
    return recipients.map((recipient) => {
      const customer = recipient === customerRecipient,
        admin = settings.adminRecipients.includes(recipient);
      return this.store.queue({
        occurrence,
        bookingId: booking.id,
        reference: booking.reference,
        event: notificationEvent,
        audience: customer && admin ? "both" : customer ? "customer" : "admin",
        recipient,
        subject: `${BRAND_CONFIG.name} ${booking.reference} — ${event === "request.rescheduled" ? "Rescheduled" : status}`,
        text: `${rule.message ? `${rule.message}\n\n` : ""}${text}\nEvent recorded: ${event === "request.rescheduled" ? change?.createdAt : (booking.events.at(-1)?.createdAt ?? booking.createdAt)}`,
        bookingStatus: booking.status,
        scheduleRevision: booking.scheduleRevision ?? 0,
        enabled:
          settings.emailEnabled &&
          ((customer && rule.customerEnabled) || (admin && rule.adminEnabled)),
      });
    });
  }

  overview(query = "", status = "", page = 0): NotificationOverview {
    if (
      query.length > 160 ||
      (status && !EMAIL_STATES.includes(status as EmailState)) ||
      !Number.isSafeInteger(page) ||
      page < 0
    )
      throw new HttpError(400, "Choose valid delivery filters and page.");
    this.store.recover();
    const list = this.store.list(query.trim().toLowerCase(), status, page);
    return {
      settings: this.store.settings(),
      connection: this.connection(),
      deliveries: list.rows.map((row) => this.publicDelivery(row)),
      total: list.total,
      page: list.page,
      counts: this.store.counts(),
    };
  }

  detail(id: string): EmailDeliveryDetail {
    this.store.recover();
    const record = this.store.get(id);
    return {
      delivery: this.publicDelivery(record),
      text: record.text,
      attempts: this.store.attempts(id),
      providerEvents: this.store.providerEvents(id),
    };
  }

  async retry(id: string, expectedAttempts: number): Promise<EmailDeliveryDetail> {
    this.store.recover();
    const record = this.store.get(id);
    if (["accepted", "preview"].includes(record.status)) return this.detail(id);
    if (!Number.isSafeInteger(expectedAttempts) || expectedAttempts < 0)
      throw new HttpError(400, "Refresh the delivery before retrying.");
    const reason = this.retryBlockedReason(record);
    if (reason) throw new HttpError(409, reason);
    if (record.attempts !== expectedAttempts)
      throw new HttpError(409, "Another send attempt was recorded. Refresh before retrying.");
    await this.perform(record, "owner");
    return this.detail(id);
  }

  async processQueued(): Promise<void> {
    this.store.recover();
    const rows = this.store.database.connection
      .prepare(
        `SELECT id FROM ${this.store.deliveriesTable} WHERE status = 'queued' AND event != 'history.link' ORDER BY created_at LIMIT 1000`,
      )
      .all();
    let sent = 0;
    for (const row of rows) {
      const record = this.store.get(String(row.id));
      if (record.status !== "queued") continue;
      const reason = this.retryBlockedReason(record);
      if (reason) {
        if (reason.startsWith("This email describes") || reason.startsWith("This recipient"))
          this.store.database.connection
            .prepare(
              `UPDATE ${this.store.deliveriesTable} SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
            )
            .run(
              reason.startsWith("This email describes") ? "superseded" : "skipped",
              reason,
              new Date().toISOString(),
              record.id,
            );
        continue;
      }
      try {
        await this.perform(record, "system");
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 409)) throw error;
      }
      if (++sent >= 5) break;
    }
  }

  receiveResendWebhook(body: string, headers: IncomingHttpHeaders): void {
    const event = verifyResendEvent(body, headers, this.env.RESEND_WEBHOOK_SECRET ?? "");
    this.store.recordResendEvent(event, body);
  }

  connection(): EmailConnection {
    const mode = this.transport().mode;
    const latest = this.store.latestAttempt();
    const selectedResend =
      this.env.ASA_BOLT_EMAIL_PROVIDER === "resend" || Boolean(this.env.RESEND_API_KEY);
    const messages = {
      resend:
        "Resend is configured. Sending is available; signed delivery updates distinguish provider acceptance from delivery to the recipient server.",
      webhook:
        "HTTPS email adapter configured. Provider acceptance is recorded; inbox delivery is not verified.",
      preview:
        "Development preview mode. Messages are saved privately on this server; no email reaches an inbox.",
      unconfigured: selectedResend
        ? "Resend is selected but not configured. Add RESEND_API_KEY and ASA_BOLT_EMAIL_FROM on the server."
        : "Email delivery is not connected. Configure a server-side email adapter before retrying failed sends.",
      invalid: selectedResend
        ? "Resend sender or reply-to configuration is invalid. Use valid email addresses without line breaks."
        : "The server email adapter configuration is invalid. It must use HTTPS without embedded credentials.",
    };
    return {
      mode,
      message:
        this.channel === "whatsapp"
          ? mode === "webhook"
            ? "WhatsApp HTTPS adapter configured. Provider acceptance is recorded; handset delivery is not verified. Only opted-in customers receive updates."
            : mode === "invalid"
              ? "WhatsApp adapter configuration is invalid. Use HTTPS and a server-side authorization token."
              : "Optional WhatsApp is not connected. Email remains the main channel. Configure an HTTPS adapter and authorization token before enabling it."
          : messages[mode],
      webhooksConfigured: Boolean(
        this.env.RESEND_WEBHOOK_SECRET?.startsWith("whsec_") &&
        Buffer.from(this.env.RESEND_WEBHOOK_SECRET.slice(6), "base64").length >= 16,
      ),
      idempotentRetries: this.idempotent(),
      retryWindowMinutes:
        ["resend", "webhook"].includes(mode) && this.idempotent()
          ? this.retryWindowMinutes()
          : null,
      lastAttemptAt: latest?.at ?? null,
      lastAttemptStatus: latest?.status ?? null,
    };
  }

  private transport(): {
    mode: EmailConnection["mode"];
    key: string;
    url?: string;
    sender?: string;
    replyTo?: string;
  } {
    if (this.channel === "whatsapp") {
      const configured = this.env.ASA_BOLT_WHATSAPP_WEBHOOK_URL?.trim();
      if (!configured) return { mode: "unconfigured", key: "" };
      try {
        const url = new URL(configured),
          token = this.env.ASA_BOLT_WHATSAPP_WEBHOOK_TOKEN?.trim();
        if (url.protocol !== "https:" || url.username || url.password || !token) throw new Error();
        return {
          mode: "webhook",
          key: createHash("sha256")
            .update(JSON.stringify([url.href, token]))
            .digest("hex"),
          url: url.href,
        };
      } catch {
        return { mode: "invalid", key: "" };
      }
    }
    if (this.env.ASA_BOLT_EMAIL_PROVIDER === "resend" || Boolean(this.env.RESEND_API_KEY)) {
      const key = this.env.RESEND_API_KEY?.trim(),
        sender = this.env.ASA_BOLT_EMAIL_FROM?.trim();
      const replyTo = this.env.ASA_BOLT_EMAIL_REPLY_TO?.trim() ?? "";
      if (!key || !sender) {
        if (
          !key &&
          !sender &&
          this.env.ASA_BOLT_EMAIL_OUTBOX_DIR &&
          this.env.NODE_ENV !== "production"
        )
          return { mode: "preview", key: "preview" };
        return { mode: "unconfigured", key: "" };
      }
      try {
        const mailbox = /^(?:[^<>\r\n]+<([^<>\s]+)>|([^<>\s]+))$/.exec(sender);
        if (
          sender.length > 320 ||
          [...sender].some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ) ||
          !mailbox
        )
          throw new Error();
        normalizeEmail(mailbox[1] ?? mailbox[2]);
        if (replyTo) normalizeEmail(replyTo);
      } catch {
        return { mode: "invalid", key: "" };
      }
      return {
        mode: "resend",
        key: `resend:${createHash("sha256")
          .update(JSON.stringify([key, sender, replyTo]))
          .digest("hex")}`,
        url: "https://api.resend.com/emails",
        sender,
        replyTo,
      };
    }
    const webhook = this.env.ASA_BOLT_EMAIL_WEBHOOK_URL?.trim();
    if (webhook) {
      try {
        const url = new URL(webhook);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error();
        return {
          mode: "webhook",
          key: createHash("sha256")
            .update(JSON.stringify([url.href, this.env.ASA_BOLT_EMAIL_WEBHOOK_TOKEN ?? ""]))
            .digest("hex"),
          url: url.href,
        };
      } catch {
        return { mode: "invalid", key: "" };
      }
    }
    if (this.env.ASA_BOLT_EMAIL_OUTBOX_DIR && this.env.NODE_ENV !== "production")
      return { mode: "preview", key: "preview" };
    return { mode: "unconfigured", key: "" };
  }

  private idempotent(): boolean {
    const mode = this.transport().mode;
    return (
      mode === "preview" ||
      mode === "resend" ||
      (mode === "webhook" &&
        this.env[
          this.channel === "email"
            ? "ASA_BOLT_EMAIL_WEBHOOK_IDEMPOTENT"
            : "ASA_BOLT_WHATSAPP_WEBHOOK_IDEMPOTENT"
        ] === "true" &&
        this.retryWindowMinutes() > 0)
    );
  }

  private retryWindowMinutes(): number {
    if (this.transport().mode === "resend") return 1380;
    const value = Number(
      this.env[
        this.channel === "email"
          ? "ASA_BOLT_EMAIL_WEBHOOK_IDEMPOTENCY_MINUTES"
          : "ASA_BOLT_WHATSAPP_WEBHOOK_IDEMPOTENCY_MINUTES"
      ] ?? 60,
    );
    return Number.isSafeInteger(value) && value > 0 && value <= 10080 ? value : 0;
  }

  private retryBlockedReason(record: StoredEmail): string {
    if (record.event === "history.link")
      return "Private history links cannot be replayed. The customer must request a fresh short-lived link.";
    if (
      [
        "accepted",
        "preview",
        "skipped",
        "delivered",
        "delayed",
        "bounced",
        "complained",
        "delivery_failed",
        "superseded",
      ].includes(record.status)
    )
      return "This email has already been accepted, previewed, or disabled. It cannot be retried.";
    if (this.channel === "whatsapp" && ["customer", "both"].includes(record.audience)) {
      const consent = this.store.database.connection
        .prepare(
          "SELECT whatsapp_number, whatsapp_consent_at, whatsapp_opt_out_at FROM bookings WHERE id = ?",
        )
        .get(record.bookingId);
      if (
        !consent?.whatsapp_consent_at ||
        consent.whatsapp_opt_out_at ||
        consent.whatsapp_number !== record.recipient
      )
        return "This recipient has not consented to WhatsApp updates.";
    }
    if (record.status === "sending")
      return "This email is already being sent. Refresh its status shortly.";
    const booking = this.store.database.connection
      .prepare("SELECT status, schedule_revision FROM bookings WHERE id = ?")
      .get(record.bookingId);
    if (
      !booking ||
      booking.status !== record.bookingStatus ||
      Number(booking.schedule_revision) !== record.scheduleRevision
    )
      return "This email describes an older ride status or pickup. A stale update cannot be resent; use the latest delivery record.";
    const settings = this.store.settings(),
      rule = settings.events[record.event];
    const customer = ["customer", "both"].includes(record.audience) && rule.customerEnabled;
    const admin =
      ["admin", "both"].includes(record.audience) &&
      rule.adminEnabled &&
      settings.adminRecipients.includes(record.recipient);
    if (!settings.emailEnabled || (!customer && !admin))
      return "This recipient or event is disabled in the current notification settings.";
    const transport = this.transport();
    if (["unconfigured", "invalid"].includes(transport.mode)) return this.connection().message;
    if (
      record.status === "uncertain" &&
      (!this.idempotent() || transport.key !== record.transportKey)
    )
      return "Provider acceptance is unknown. Retry requires the same adapter with verified idempotency support; check the provider before resending.";
    if (
      record.status === "uncertain" &&
      ["resend", "webhook"].includes(transport.mode) &&
      Date.now() - new Date(record.createdAt).getTime() >= this.retryWindowMinutes() * 60_000
    )
      return "The adapter's safe retry window has expired. Check the provider; this uncertain email cannot be resent safely.";
    return "";
  }

  private publicDelivery(record: StoredEmail): EmailDelivery {
    const reason = this.retryBlockedReason(record);
    return {
      id: record.id,
      bookingId: record.bookingId,
      reference: record.reference,
      event: record.event,
      audience: record.audience,
      recipient: record.recipient,
      subject: record.subject,
      status: record.status,
      attempts: record.attempts,
      lastError: record.lastError,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      provider: record.provider,
      providerMessageId: record.providerMessageId,
      retryable: !reason,
      retryBlockedReason: reason,
    };
  }

  private perform(
    record: StoredEmail,
    actor: "system" | "owner",
    privateText?: string,
  ): Promise<StoredEmail> {
    const active = this.activeSends.get(record.id);
    if (active) return active;
    const send = async () => {
      if (this.transport().mode === "resend") {
        const slot = this.nextResendSlot;
        this.nextResendSlot = slot.then(
          () => new Promise<void>((resolve) => setTimeout(resolve, 550)),
        );
        await slot;
      }
      const fresh = this.store.get(record.id);
      if (fresh.status !== record.status || fresh.attempts !== record.attempts)
        throw new HttpError(409, "The delivery changed before sending. Refresh its status.");
      if (record.event !== "history.link") {
        const reason = this.retryBlockedReason(record);
        if (reason.startsWith("This email describes") || reason.startsWith("This recipient")) {
          this.store.database.connection
            .prepare(
              `UPDATE ${this.store.deliveriesTable} SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
            )
            .run(
              reason.startsWith("This email describes") ? "superseded" : "skipped",
              reason,
              new Date().toISOString(),
              record.id,
            );
          if (actor === "owner") throw new HttpError(409, reason);
          return this.store.get(record.id);
        }
      }
      if (actor === "owner" || record.status === "uncertain") {
        const reason = this.retryBlockedReason(fresh);
        if (reason) throw new HttpError(409, reason);
      }
      return this.performNow(fresh, actor, privateText);
    };
    const pending = send();
    this.activeSends.set(record.id, pending);
    void pending.then(
      () => this.activeSends.delete(record.id),
      () => this.activeSends.delete(record.id),
    );
    return pending;
  }

  private async performNow(
    record: StoredEmail,
    actor: "system" | "owner",
    privateText?: string,
  ): Promise<StoredEmail> {
    const transport = this.transport();
    const current = this.store.claim(
      record.id,
      record.attempts,
      actor,
      transport.key,
      transport.mode,
      transport.sender,
      transport.replyTo,
    );
    let status: EmailState = "failed",
      error = "",
      providerMessageId = "";
    const message: EmailMessage = {
      to: current.recipient,
      subject: current.subject,
      text: privateText ?? current.text,
    };
    const wireEvent =
      EMAIL_EVENTS.includes(current.event as EmailEvent) &&
      !["request.received", "request.rescheduled"].includes(current.event)
        ? "request.updated"
        : current.event;
    const envelope = {
      event: wireEvent,
      notificationEvent: current.event,
      brand: BRAND_CONFIG.name,
      channel: this.channel,
      deliveryId: current.id,
      idempotencyKey: current.id,
      payload: message,
    };
    if (transport.mode === "resend") {
      try {
        const response = await this.sendRequest(transport.url!, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.RESEND_API_KEY!.trim()}`,
            "Idempotency-Key": current.id,
          },
          body: JSON.stringify({
            from: current.sender,
            to: [current.recipient],
            subject: current.subject,
            text: message.text,
            ...(current.replyTo ? { reply_to: current.replyTo } : {}),
            tags: [{ name: "asa_delivery_id", value: current.id }],
          }),
        });
        if (response.ok) {
          const result = (await response.json()) as { id?: unknown };
          if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/i.test(result.id))
            throw new Error("Missing provider ID");
          status = "accepted";
          providerMessageId = result.id;
        } else {
          status =
            record.status === "uncertain" ||
            response.status >= 500 ||
            [408, 409].includes(response.status)
              ? "uncertain"
              : "failed";
          error = `Resend returned HTTP ${response.status}.${status === "uncertain" ? " Acceptance is unknown." : " The email was not accepted; check sender verification and account configuration."}`;
          await response.body?.cancel().catch(() => undefined);
        }
      } catch {
        status = "uncertain";
        error =
          "Resend did not return a confirmed result. Acceptance is unknown; retry uses the same delivery ID.";
      }
    } else if (transport.mode === "webhook") {
      try {
        const response = await this.sendRequest(transport.url!, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": current.id,
            ...(this.env[
              this.channel === "email"
                ? "ASA_BOLT_EMAIL_WEBHOOK_TOKEN"
                : "ASA_BOLT_WHATSAPP_WEBHOOK_TOKEN"
            ]
              ? {
                  Authorization: `Bearer ${this.env[this.channel === "email" ? "ASA_BOLT_EMAIL_WEBHOOK_TOKEN" : "ASA_BOLT_WHATSAPP_WEBHOOK_TOKEN"]}`,
                }
              : {}),
          },
          body: JSON.stringify(envelope),
        });
        if (response.ok) status = "accepted";
        else {
          status =
            record.status === "uncertain" ||
            response.status >= 500 ||
            [408, 409].includes(response.status)
              ? "uncertain"
              : "failed";
          error = `The message adapter returned HTTP ${response.status}.${status === "uncertain" ? " Acceptance is unknown." : " The message was not accepted."}`;
        }
        await response.body?.cancel().catch(() => undefined);
      } catch {
        status = "uncertain";
        error = "The message adapter did not return a confirmed result. Acceptance is unknown.";
      }
    } else if (transport.mode === "preview") {
      try {
        const directory = this.env.ASA_BOLT_EMAIL_OUTBOX_DIR!;
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `${current.id}.json`);
        const preview = JSON.stringify({ ...envelope, ...message }, null, 2);
        try {
          writeFileSync(path, preview, { mode: 0o600, flag: "wx" });
        } catch (cause) {
          if (
            (cause as NodeJS.ErrnoException).code !== "EEXIST" ||
            readFileSync(path, "utf8") !== preview
          )
            throw cause;
        }
        status = "preview";
      } catch {
        error =
          "The private development preview could not be saved. Check the server outbox configuration.";
      }
    } else error = this.connection().message;
    return this.store.finish(current.id, current.attempts, status, error, providerMessageId);
  }
}

function resultFor(record: StoredEmail): NotificationResult {
  return {
    channel: "email",
    status: ["accepted", "delivered", "delayed"].includes(record.status)
      ? "delivered"
      : record.status === "preview"
        ? "mocked"
        : record.status === "skipped"
          ? "skipped"
          : ["sending", "queued"].includes(record.status)
            ? "queued"
            : "failed",
  };
}
