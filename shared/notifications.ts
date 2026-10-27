export const EMAIL_EVENTS = [
  "request.received",
  "request.accepted",
  "request.rejected",
  "request.cancelled",
  "request.rescheduled",
  "ride.picked_up",
  "ride.arrived",
  "ride.completed",
] as const;

export type EmailEvent = (typeof EMAIL_EVENTS)[number];
export const EMAIL_EVENT_LABELS: Record<EmailEvent, string> = {
  "request.received": "Request received",
  "request.accepted": "Request accepted",
  "request.rejected": "Request rejected",
  "request.cancelled": "Ride cancelled",
  "request.rescheduled": "Pickup rescheduled",
  "ride.picked_up": "Customer picked up",
  "ride.arrived": "Arrived at destination",
  "ride.completed": "Ride completed",
};

export const EMAIL_STATES = [
  "queued",
  "sending",
  "accepted",
  "preview",
  "failed",
  "uncertain",
  "skipped",
  "delivered",
  "delayed",
  "bounced",
  "complained",
  "delivery_failed",
  "superseded",
] as const;
export type EmailState = (typeof EMAIL_STATES)[number];
export const EMAIL_STATE_LABELS: Record<EmailState, string> = {
  queued: "Queued",
  sending: "Sending",
  accepted: "Provider accepted",
  preview: "Local preview only",
  failed: "Failed",
  uncertain: "Delivery uncertain",
  skipped: "Disabled by settings",
  delivered: "Delivered to recipient server",
  delayed: "Delivery delayed",
  bounced: "Email bounced",
  complained: "Marked as spam",
  delivery_failed: "Provider delivery failed",
  superseded: "Replaced by a newer update",
};

export interface EmailEventSetting {
  customerEnabled: boolean;
  adminEnabled: boolean;
  message: string;
}
export interface NotificationSettings {
  revision: number;
  emailEnabled: boolean;
  adminRecipients: string[];
  events: Record<EmailEvent, EmailEventSetting>;
  updatedAt: string;
}
export interface EmailDelivery {
  id: string;
  bookingId: string | null;
  reference: string;
  event: EmailEvent | "history.link";
  audience: "customer" | "admin" | "both";
  recipient: string;
  subject: string;
  status: EmailState;
  attempts: number;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  retryable: boolean;
  retryBlockedReason: string;
  provider: string;
  providerMessageId: string;
}
export interface EmailAttempt {
  number: number;
  status: EmailState;
  actor: "system" | "owner";
  error: string;
  startedAt: string;
  finishedAt: string | null;
}
export interface EmailDeliveryDetail {
  delivery: EmailDelivery;
  text: string;
  attempts: EmailAttempt[];
  providerEvents: Array<{ type: string; createdAt: string; receivedAt: string }>;
}
export interface EmailConnection {
  mode: "resend" | "webhook" | "preview" | "unconfigured" | "invalid";
  webhooksConfigured: boolean;
  message: string;
  idempotentRetries: boolean;
  retryWindowMinutes: number | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: EmailState | null;
}
export interface NotificationOverview {
  settings: NotificationSettings;
  connection: EmailConnection;
  deliveries: EmailDelivery[];
  total: number;
  page: number;
  counts: Record<EmailState, number>;
}
