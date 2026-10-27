import type { Booking } from "../../shared/contracts";
import type { EmailState } from "../../shared/notifications";

const messages: Record<EmailState, string> = {
  accepted: "Email accepted for sending. Inbox delivery has not been confirmed.",
  preview: "Live email delivery is not connected. Keep your private status link.",
  failed: "Email delivery failed. Your request remains saved; keep your private status link.",
  uncertain: "Email delivery could not be confirmed. Keep your private status link for updates.",
  queued: "Your email update is queued. Keep your private status link.",
  sending: "Your email update is being sent. Keep your private status link.",
  skipped: "Email updates are disabled for this event. Use your private status link for updates.",
  delivered: "Email delivered to your email server. Check your inbox or spam folder.",
  delayed: "Your email provider has delayed delivery. Use your private status link for updates.",
  bounced:
    "Your email server rejected this message. Your request remains saved; keep your private status link.",
  complained:
    "Email delivery is stopped after a spam report. Use your private status link for updates.",
  delivery_failed:
    "The email provider could not deliver this message. Your request remains saved; keep your private status link.",
  superseded: "A newer ride update is available. Use your private status link for current details.",
};
export function EmailDeliveryStatus({ booking }: { booking: Booking }) {
  if (!booking.email) return <>This older request has no customer email address.</>;
  if (booking.customerEmailStatus) return <>{messages[booking.customerEmailStatus]}</>;
  return (
    <>
      {booking.notificationStatus === "delivered"
        ? messages.accepted
        : booking.notificationStatus === "failed"
          ? messages.failed
          : booking.notificationStatus === "queued"
            ? messages.queued
            : messages.preview}
    </>
  );
}
