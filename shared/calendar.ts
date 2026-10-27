export const CALENDAR_STATES = [
  "awaiting_setup",
  "queued",
  "syncing",
  "synced",
  "cancelled",
  "failed",
] as const;
export type CalendarState = (typeof CALENDAR_STATES)[number];
export const CALENDAR_STATE_LABELS: Record<CalendarState, string> = {
  awaiting_setup: "Awaiting calendar setup",
  queued: "Queued",
  syncing: "Updating Google Calendar",
  synced: "Synced",
  cancelled: "Calendar event cancelled",
  failed: "Update failed",
};
export interface CalendarChoice {
  id: string;
  name: string;
  primary: boolean;
}
export interface CalendarUpdate {
  bookingId: string;
  reference: string;
  eventId: string;
  calendarId: string;
  status: CalendarState;
  revision: number;
  attempts: number;
  lastError: string;
  updatedAt: string;
  retryable: boolean;
}
export interface CalendarOverview {
  configured: boolean;
  missing: string[];
  connected: boolean;
  ready: boolean;
  account: string;
  calendarId: string;
  calendarName: string;
  revision: number;
  lastCheckedAt: string | null;
  lastError: string;
  callbackUrl: string;
  updates: CalendarUpdate[];
  counts: Record<CalendarState, number>;
}
