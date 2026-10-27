import type { Booking, LocationRequest } from "../../../shared/contracts.js";
import { BRAND_CONFIG } from "../../../shared/config.js";

export type NotificationDeliveryStatus = "delivered" | "mocked" | "failed" | "skipped" | "queued";

export interface NotificationResult {
  channel: string;
  status: NotificationDeliveryStatus;
}

export interface NotificationGateway {
  notifyBookingCreated(booking: Booking): Promise<NotificationResult[]>;
  notifyBookingRescheduled?(booking: Booking): Promise<NotificationResult[]>;
  notifyStatusChanged(booking: Booking): Promise<NotificationResult[]>;
  notifyLocationRequestReviewed(request: LocationRequest): Promise<NotificationResult[]>;
}

interface NotificationAdapter {
  readonly channel: string;
  notifyBookingCreated(booking: Booking): Promise<NotificationResult>;
  notifyStatusChanged(booking: Booking): Promise<NotificationResult>;
  notifyLocationRequestReviewed(request: LocationRequest): Promise<NotificationResult>;
}

class ConsoleDeliveryAdapter implements NotificationAdapter {
  readonly channel = "console";

  notifyBookingCreated(booking: Booking): Promise<NotificationResult> {
    console.info(`[notification:mock] new booking ${booking.reference}`);
    return Promise.resolve({ channel: this.channel, status: "mocked" });
  }

  notifyStatusChanged(booking: Booking): Promise<NotificationResult> {
    console.info(`[notification:mock] ${booking.reference} is ${booking.status}`);
    return Promise.resolve({ channel: this.channel, status: "mocked" });
  }

  notifyLocationRequestReviewed(request: LocationRequest): Promise<NotificationResult> {
    console.info(`[notification:mock] location request ${request.id} is ${request.status}`);
    return Promise.resolve({ channel: this.channel, status: "mocked" });
  }
}

export class ConsoleNotificationAdapter implements NotificationGateway {
  private readonly delivery = new ConsoleDeliveryAdapter();

  notifyBookingCreated(booking: Booking): Promise<NotificationResult[]> {
    return this.delivery.notifyBookingCreated(booking).then((result) => [result]);
  }

  notifyStatusChanged(booking: Booking): Promise<NotificationResult[]> {
    return this.delivery.notifyStatusChanged(booking).then((result) => [result]);
  }

  notifyLocationRequestReviewed(request: LocationRequest): Promise<NotificationResult[]> {
    return this.delivery.notifyLocationRequestReviewed(request).then((result) => [result]);
  }
}

export class WebhookNotificationAdapter implements NotificationAdapter {
  constructor(
    readonly channel: string,
    private readonly webhookUrl: string,
    private readonly authorizationToken: string,
  ) {}

  notifyBookingCreated(booking: Booking): Promise<NotificationResult> {
    if (this.channel === "whatsapp" && !booking.phone)
      return Promise.resolve({ channel: this.channel, status: "skipped" });
    return this.deliver("booking.created", booking);
  }

  notifyStatusChanged(booking: Booking): Promise<NotificationResult> {
    if (this.channel === "whatsapp" && !booking.phone)
      return Promise.resolve({ channel: this.channel, status: "skipped" });
    return this.deliver("booking.status_changed", booking);
  }

  notifyBookingRescheduled(booking: Booking): Promise<NotificationResult> {
    if (this.channel === "whatsapp" && !booking.phone)
      return Promise.resolve({ channel: this.channel, status: "skipped" });
    return this.deliver("booking.rescheduled", booking);
  }

  notifyLocationRequestReviewed(request: LocationRequest): Promise<NotificationResult> {
    return this.deliver("location_request.reviewed", request);
  }

  private async deliver(
    event: string,
    payload: Booking | LocationRequest,
  ): Promise<NotificationResult> {
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ event, brand: BRAND_CONFIG.name, payload }),
    });
    if (!response.ok)
      throw new Error(`${this.channel} notification returned HTTP ${response.status}.`);
    return { channel: this.channel, status: "delivered" };
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.authorizationToken ? { Authorization: `Bearer ${this.authorizationToken}` } : {}),
    };
  }
}

class CompositeNotificationGateway implements NotificationGateway {
  constructor(
    private readonly adapters: NotificationAdapter[],
    private readonly separateBookingEmail = false,
  ) {}

  notifyBookingCreated(booking: Booking): Promise<NotificationResult[]> {
    return this.notify(
      (adapter) => adapter.notifyBookingCreated(booking),
      this.separateBookingEmail,
    );
  }

  notifyStatusChanged(booking: Booking): Promise<NotificationResult[]> {
    return this.notify(
      (adapter) => adapter.notifyStatusChanged(booking),
      this.separateBookingEmail,
    );
  }

  notifyBookingRescheduled(booking: Booking): Promise<NotificationResult[]> {
    return this.notify(
      (adapter) =>
        adapter instanceof WebhookNotificationAdapter
          ? adapter.notifyBookingRescheduled(booking)
          : adapter.notifyStatusChanged(booking),
      this.separateBookingEmail,
    );
  }

  notifyLocationRequestReviewed(request: LocationRequest): Promise<NotificationResult[]> {
    return this.notify((adapter) => adapter.notifyLocationRequestReviewed(request));
  }

  private async notify(
    send: (adapter: NotificationAdapter) => Promise<NotificationResult>,
    skipEmail = false,
  ): Promise<NotificationResult[]> {
    const adapters = this.adapters.filter((adapter) => !skipEmail || adapter.channel !== "email");
    const attempts = await Promise.allSettled(adapters.map(send));
    return attempts.map((attempt, index) => failureSafeResult(attempt, adapters[index].channel));
  }
}

export function createNotificationGateway(
  env: NodeJS.ProcessEnv,
  options: { separateBookingEmail?: boolean } = {},
): NotificationGateway {
  const adapters = configuredAdapters(env).filter(
    (adapter) => !options.separateBookingEmail || adapter.channel !== "whatsapp",
  );
  return new CompositeNotificationGateway(
    adapters.length > 0 ? adapters : [new ConsoleDeliveryAdapter()],
    options.separateBookingEmail,
  );
}

function configuredAdapters(env: NodeJS.ProcessEnv): NotificationAdapter[] {
  const email = webhookFromEnvironment(env, "ASA_BOLT_EMAIL_WEBHOOK_URL", "email");
  const whatsapp = webhookFromEnvironment(env, "ASA_BOLT_WHATSAPP_WEBHOOK_URL", "whatsapp");
  return [email, whatsapp].filter((adapter): adapter is NotificationAdapter => Boolean(adapter));
}

function webhookFromEnvironment(
  env: NodeJS.ProcessEnv,
  urlKey: string,
  channel: string,
): NotificationAdapter | undefined {
  const url = env[urlKey]?.trim();
  if (!url) return undefined;
  const tokenKey =
    channel === "email" ? "ASA_BOLT_EMAIL_WEBHOOK_TOKEN" : "ASA_BOLT_WHATSAPP_WEBHOOK_TOKEN";
  return new WebhookNotificationAdapter(channel, url, env[tokenKey]?.trim() ?? "");
}

function failureSafeResult(
  attempt: PromiseSettledResult<NotificationResult>,
  channel: string,
): NotificationResult {
  if (attempt.status === "fulfilled") return attempt.value;
  console.error(`[notification:${channel}] delivery failed`);
  return { channel, status: "failed" };
}
