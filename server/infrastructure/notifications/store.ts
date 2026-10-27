import { createHash, randomUUID } from "node:crypto";
import type { BookingStatus } from "../../../shared/config.js";
import {
  EMAIL_EVENTS,
  EMAIL_STATES,
  type EmailAttempt,
  type EmailDelivery,
  type EmailState,
  type NotificationSettings,
} from "../../../shared/notifications.js";
import { normalizePhone, normalizeEmail } from "../../domain/rules.js";
import { HttpError } from "../../errors.js";
import type { Database } from "../database.js";
import type { ResendEvent } from "./resend.js";

type Row = Record<string, unknown>;
export interface StoredEmail extends Omit<EmailDelivery, "retryable" | "retryBlockedReason"> {
  text: string;
  bookingStatus: string;
  scheduleRevision: number;
  transportKey: string;
  sender: string;
  replyTo: string;
}
export interface NewEmail {
  occurrence: string;
  bookingId: string | null;
  reference: string;
  event: StoredEmail["event"];
  audience: StoredEmail["audience"];
  recipient: string;
  subject: string;
  text: string;
  bookingStatus?: BookingStatus;
  scheduleRevision?: number;
  enabled: boolean;
}

export class EmailStore {
  get deliveriesTable(): string {
    return `${this.channel}_deliveries`;
  }
  private normalizeRecipient(value: string): string {
    return this.channel === "whatsapp" ? normalizePhone(value) : normalizeEmail(value);
  }
  constructor(
    readonly database: Database,
    initialRecipients: string,
    readonly channel: "email" | "whatsapp" = "email",
  ) {
    const recipients = initialRecipients
      .split(/[,;\n]/)
      .filter(Boolean)
      .flatMap((value) => {
        try {
          return [this.normalizeRecipient(value)];
        } catch {
          return [];
        }
      });
    const settings: NotificationSettings = {
      revision: 0,
      emailEnabled: channel === "email",
      adminRecipients: [...new Set(recipients)].slice(0, 10),
      events: Object.fromEntries(
        EMAIL_EVENTS.map((event) => [
          event,
          {
            customerEnabled: true,
            adminEnabled: true,
            message: "",
          },
        ]),
      ) as NotificationSettings["events"],
      updatedAt: new Date().toISOString(),
    };
    database.connection
      .prepare(
        `INSERT OR IGNORE INTO ${this.channel === "email" ? "notification_settings" : "whatsapp_notification_settings"} (id, revision, settings_json, updated_at) VALUES (1, 0, ?, ?)`,
      )
      .run(JSON.stringify(settings), settings.updatedAt);
  }

  settings(): NotificationSettings {
    const row = this.database.connection
      .prepare(
        `SELECT settings_json FROM ${this.channel === "email" ? "notification_settings" : "whatsapp_notification_settings"} WHERE id = 1`,
      )
      .get();
    return JSON.parse(String(row?.settings_json)) as NotificationSettings;
  }

  saveSettings(value: unknown): NotificationSettings {
    const input = object(value);
    if (
      !Number.isSafeInteger(input.revision) ||
      typeof input.emailEnabled !== "boolean" ||
      !Array.isArray(input.adminRecipients) ||
      input.adminRecipients.length > 10
    )
      throw new HttpError(400, "Supply valid settings and up to ten admin recipients.");
    const recipients = [
      ...new Set(
        input.adminRecipients.map((item: unknown) => {
          if (typeof item !== "string") throw new HttpError(400, "Enter valid admin recipients.");
          try {
            return this.normalizeRecipient(item);
          } catch {
            throw new HttpError(
              400,
              "Enter valid admin recipients, one per line or separated by commas.",
            );
          }
        }),
      ),
    ];
    const events = object(input.events);
    const validatedEvents = Object.fromEntries(
      EMAIL_EVENTS.map((event) => {
        const rule = object(events[event]);
        if (
          typeof rule.customerEnabled !== "boolean" ||
          typeof rule.adminEnabled !== "boolean" ||
          typeof rule.message !== "string" ||
          rule.message.trim().length > 1000 ||
          rule.message.includes("\u0000")
        )
          throw new HttpError(
            400,
            "Each event needs customer/admin switches and message text of at most 1,000 characters.",
          );
        return [
          event,
          {
            customerEnabled: rule.customerEnabled,
            adminEnabled: rule.adminEnabled,
            message: rule.message.trim(),
          },
        ];
      }),
    ) as NotificationSettings["events"];
    const settings: NotificationSettings = {
      revision: Number(input.revision) + 1,
      emailEnabled: input.emailEnabled,
      adminRecipients: recipients,
      events: validatedEvents,
      updatedAt: new Date().toISOString(),
    };
    const result = this.database.connection
      .prepare(
        `UPDATE ${this.channel === "email" ? "notification_settings" : "whatsapp_notification_settings"} SET settings_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?`,
      )
      .run(JSON.stringify(settings), settings.revision, settings.updatedAt, Number(input.revision));
    if (!result.changes)
      throw new HttpError(
        409,
        "Notification settings changed. Load the saved settings before trying again.",
      );
    return settings;
  }

  queue(input: NewEmail): StoredEmail {
    const id = randomUUID(),
      now = new Date().toISOString();
    const key = createHash("sha256")
      .update(JSON.stringify([input.occurrence, input.recipient]))
      .digest("hex");
    this.database.connection
      .prepare(
        `INSERT OR IGNORE INTO ${this.channel}_deliveries (id, dedupe_key, booking_id, reference, event, audience, recipient, subject, message_text, booking_status, schedule_revision, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        key,
        input.bookingId,
        input.reference,
        input.event,
        input.audience,
        input.recipient,
        input.subject,
        input.event === "history.link" ? "" : input.text,
        input.bookingStatus ?? "",
        input.scheduleRevision ?? 0,
        input.enabled ? "queued" : "skipped",
        now,
        now,
      );
    const row = this.database.connection
      .prepare(`SELECT * FROM ${this.channel}_deliveries WHERE dedupe_key = ?`)
      .get(key);
    return stored(row!);
  }

  recover(): void {
    const db = this.database.connection;
    const reason = "The send was interrupted. Provider acceptance is unknown.";
    const now = new Date().toISOString();
    const cutoff = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `UPDATE ${this.channel}_attempts SET status = 'uncertain', error = ?, finished_at = ? WHERE finished_at IS NULL AND delivery_id IN (SELECT id FROM ${this.channel}_deliveries WHERE status = 'sending' AND lease_until <= ?)`,
      ).run(reason, now, cutoff);
      db.prepare(
        `UPDATE ${this.channel}_deliveries SET status = 'uncertain', last_error = ?, lease_until = NULL, updated_at = ? WHERE status = 'sending' AND lease_until <= ?`,
      ).run(reason, now, cutoff);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: string): StoredEmail {
    const row = this.database.connection
      .prepare(`SELECT * FROM ${this.channel}_deliveries WHERE id = ?`)
      .get(id);
    if (!row) throw new HttpError(404, "Email delivery not found.");
    return stored(row);
  }

  claim(
    id: string,
    expectedAttempts: number,
    actor: "system" | "owner",
    transportKey: string,
    provider = "",
    sender = "",
    replyTo = "",
  ): StoredEmail {
    const db = this.database.connection,
      now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          `UPDATE ${this.channel}_deliveries SET status = 'sending', last_error = '', attempts = attempts + 1, lease_until = ?, transport_key = ?, provider = ?, reply_to = CASE WHEN sender = '' THEN ? ELSE reply_to END, sender = CASE WHEN sender = '' THEN ? ELSE sender END, updated_at = ? WHERE id = ? AND attempts = ? AND status IN ('queued', 'failed', 'uncertain')`,
        )
        .run(
          Date.now() + 30_000,
          transportKey,
          provider,
          replyTo,
          sender,
          now,
          id,
          expectedAttempts,
        );
      if (!result.changes)
        throw new HttpError(
          409,
          "This delivery changed or is already being sent. Refresh its status.",
        );
      const current = this.get(id);
      db.prepare(
        `INSERT INTO ${this.channel}_attempts (delivery_id, attempt_number, status, actor, started_at) VALUES (?, ?, 'sending', ?, ?)`,
      ).run(id, current.attempts, actor, now);
      db.exec("COMMIT");
      return current;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  finish(
    id: string,
    attempt: number,
    status: EmailState,
    error: string,
    providerMessageId = "",
  ): StoredEmail {
    const db = this.database.connection,
      now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `UPDATE ${this.channel}_deliveries SET status = CASE WHEN status IN ('accepted', 'delivered', 'bounced', 'complained', 'delivery_failed', 'delayed') THEN status ELSE ? END, last_error = CASE WHEN status IN ('accepted', 'delivered', 'bounced', 'complained', 'delivery_failed', 'delayed') THEN last_error ELSE ? END, provider_message_id = CASE WHEN ? != '' THEN ? ELSE provider_message_id END, lease_until = NULL, updated_at = ? WHERE id = ? AND attempts = ?`,
      ).run(status, error, providerMessageId, providerMessageId, now, id, attempt);
      db.prepare(
        `UPDATE ${this.channel}_attempts SET status = ?, error = ?, finished_at = ? WHERE delivery_id = ? AND attempt_number = ?`,
      ).run(status, error, now, id, attempt);
      const current = this.get(id);
      if (current.providerMessageId) this.applyProviderEvents(id, current.providerMessageId);
      db.exec("COMMIT");
      return this.get(id);
    } catch (cause) {
      db.exec("ROLLBACK");
      throw cause;
    }
  }

  attempts(id: string): EmailAttempt[] {
    return this.database.connection
      .prepare(
        `SELECT * FROM ${this.channel}_attempts WHERE delivery_id = ? ORDER BY attempt_number`,
      )
      .all(id)
      .map((row) => ({
        number: Number(row.attempt_number),
        status: String(row.status) as EmailState,
        actor: String(row.actor) as EmailAttempt["actor"],
        error: String(row.error),
        startedAt: String(row.started_at),
        finishedAt: row.finished_at == null ? null : String(row.finished_at),
      }));
  }

  providerEvents(id: string): Array<{ type: string; createdAt: string; receivedAt: string }> {
    return this.database.connection
      .prepare(
        `SELECT event_type, event_at, received_at FROM ${this.channel}_provider_events WHERE delivery_id = ? ORDER BY event_at, id`,
      )
      .all(id)
      .map((row) => ({
        type: String(row.event_type),
        createdAt: String(row.event_at),
        receivedAt: String(row.received_at),
      }));
  }

  recordResendEvent(event: ResendEvent, body: string): void {
    if (!event.emailId) return;
    const db = this.database.connection,
      hash = createHash("sha256").update(body).digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db
        .prepare(`SELECT payload_hash FROM ${this.channel}_provider_events WHERE id = ?`)
        .get(event.id);
      if (existing) {
        if (existing.payload_hash !== hash)
          throw new HttpError(409, "Webhook identifier already used for different data.");
        db.exec("COMMIT");
        return;
      }
      const byMessage = db
        .prepare(
          `SELECT id, provider_message_id FROM ${this.channel}_deliveries WHERE provider = 'resend' AND provider_message_id = ?`,
        )
        .get(event.emailId);
      const byTag = event.deliveryId
        ? db
            .prepare(
              `SELECT id, provider_message_id FROM ${this.channel}_deliveries WHERE provider = 'resend' AND id = ?`,
            )
            .get(event.deliveryId)
        : undefined;
      if (
        (byMessage && byTag && byMessage.id !== byTag.id) ||
        (byTag?.provider_message_id && byTag.provider_message_id !== event.emailId)
      )
        throw new HttpError(409, "Webhook email does not match this delivery.");
      const delivery = byMessage ?? byTag;
      db.prepare(
        `INSERT INTO ${this.channel}_provider_events (id, payload_hash, provider_message_id, delivery_id, event_type, event_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id,
        hash,
        event.emailId,
        delivery ? String(delivery.id) : null,
        event.type,
        event.createdAt,
        new Date().toISOString(),
      );
      if (delivery) {
        db.prepare(
          `UPDATE ${this.channel}_deliveries SET provider_message_id = ? WHERE id = ?`,
        ).run(event.emailId, String(delivery.id));
        this.applyProviderEvents(String(delivery.id), event.emailId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private applyProviderEvents(id: string, messageId: string): void {
    const db = this.database.connection;
    db.prepare(
      `UPDATE ${this.channel}_provider_events SET delivery_id = ? WHERE provider_message_id = ? AND delivery_id IS NULL`,
    ).run(id, messageId);
    const states: Record<string, { status: EmailState; priority: number; error: string }> = {
      "email.sent": { status: "accepted", priority: 1, error: "" },
      "email.delivery_delayed": {
        status: "delayed",
        priority: 2,
        error: "The recipient server has temporarily delayed delivery.",
      },
      "email.delivered": { status: "delivered", priority: 3, error: "" },
      "email.failed": {
        status: "delivery_failed",
        priority: 4,
        error:
          "Resend reported that this email could not be delivered. Review its provider record.",
      },
      "email.suppressed": {
        status: "delivery_failed",
        priority: 4,
        error:
          "Resend suppressed this destination. Review its provider record before sending again.",
      },
      "email.bounced": {
        status: "bounced",
        priority: 5,
        error: "The recipient server permanently rejected this email.",
      },
      "email.complained": {
        status: "complained",
        priority: 6,
        error: "The recipient marked this email as spam. Do not resend it.",
      },
    };
    const events = db
      .prepare(
        `SELECT event_type FROM ${this.channel}_provider_events WHERE delivery_id = ? ORDER BY event_at, id`,
      )
      .all(id);
    const selected = events
      .map((event) => states[String(event.event_type)])
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority)[0];
    if (selected)
      db.prepare(
        `UPDATE ${this.channel}_deliveries SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      ).run(selected.status, selected.error, new Date().toISOString(), id);
  }

  list(
    query: string,
    status: string,
    page: number,
  ): { rows: StoredEmail[]; total: number; page: number } {
    const where =
      "WHERE (? = '' OR status = ?) AND (? = '' OR instr(lower(recipient || ' ' || reference), ?) > 0)";
    const params = [status, status, query, query];
    const total = Number(
      this.database.connection
        .prepare(`SELECT count(*) AS count FROM ${this.channel}_deliveries ${where}`)
        .get(...params)?.count,
    );
    const currentPage = Math.min(page, Math.max(0, Math.ceil(total / 20) - 1));
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM ${this.channel}_deliveries ${where} ORDER BY created_at DESC, rowid DESC LIMIT 20 OFFSET ?`,
      )
      .all(...params, currentPage * 20);
    return { rows: rows.map(stored), total, page: currentPage };
  }

  counts(): Record<EmailState, number> {
    const counts = Object.fromEntries(EMAIL_STATES.map((status) => [status, 0])) as Record<
      EmailState,
      number
    >;
    for (const row of this.database.connection
      .prepare(`SELECT status, count(*) AS count FROM ${this.channel}_deliveries GROUP BY status`)
      .all())
      counts[String(row.status) as EmailState] = Number(row.count);
    return counts;
  }

  latestAttempt(): { status: EmailState; at: string } | null {
    const row = this.database.connection
      .prepare(
        `SELECT status, started_at FROM ${this.channel}_attempts ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get();
    return row ? { status: String(row.status) as EmailState, at: String(row.started_at) } : null;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Supply valid notification settings.");
  return value as Record<string, unknown>;
}
function stored(row: Row): StoredEmail {
  return {
    id: String(row.id),
    bookingId: row.booking_id == null ? null : String(row.booking_id),
    reference: String(row.reference),
    event: String(row.event) as StoredEmail["event"],
    audience: String(row.audience) as StoredEmail["audience"],
    recipient: String(row.recipient),
    subject: String(row.subject),
    text: String(row.message_text),
    bookingStatus: String(row.booking_status),
    scheduleRevision: Number(row.schedule_revision),
    status: String(row.status) as EmailState,
    transportKey: String(row.transport_key),
    provider: String(row.provider ?? ""),
    providerMessageId: String(row.provider_message_id ?? ""),
    sender: String(row.sender ?? ""),
    replyTo: String(row.reply_to ?? ""),
    attempts: Number(row.attempts),
    lastError: String(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
