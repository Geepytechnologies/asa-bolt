import { useCallback, useEffect, useState } from "react";
import type { BookingAccessResponse } from "../../shared/contracts";
import { apiFetch, cancelBooking, fetchBookingStatus } from "../api";
import { formatDateTime, statusLabel } from "../format";
import { ScheduleChanges } from "./ScheduleChanges";
import { FareDetails } from "./FareDetails";
import { Message } from "./Message";
import { EmailDeliveryStatus } from "./EmailDeliveryStatus";

interface CustomerStatusProps {
  token: string;
  onBack: () => void;
}

export function CustomerStatus({ token, onBack }: CustomerStatusProps) {
  const [result, setResult] = useState<BookingAccessResponse>();
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const loadStatus = useCallback(async () => {
    try {
      setResult(await fetchBookingStatus(token));
    } catch {
      setError("This status link is not available. Check the link and try again.");
    }
  }, [token]);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  const handleCancel = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCancelling(true);
      setError("");
      try {
        const updated = await cancelBooking(token, phone, reason, Boolean(result?.booking.email));
        setResult((current) => (current ? { ...current, booking: updated.booking } : current));
        setReason("");
      } catch {
        setError(
          "Use the email or phone used for this request and give a short cancellation reason.",
        );
      } finally {
        setCancelling(false);
      }
    },
    [phone, reason, token, result?.booking.email],
  );
  return (
    <main className="narrow-page">
      <button className="text-button back-button" type="button" onClick={onBack}>
        ← Back to booking
      </button>
      <div className="eyebrow">Request details</div>
      <h1>{result?.booking.reference ?? "Your request"}</h1>
      <button
        className="text-button"
        type="button"
        disabled={cancelling}
        onClick={() => {
          setError("");
          void loadStatus();
        }}
      >
        Refresh request details
      </button>
      {!result && !error && <Message tone="info">Loading your ride details…</Message>}
      {error && <Message tone="error">{error}</Message>}
      {result && (
        <section className="status-card">
          <span className="status-pill status-large">{statusLabel(result.booking.status)}</span>
          <p className="status-copy">{statusMessage(result.booking.status)}</p>
          <dl className="detail-list">
            <div>
              <dt>Pickup</dt>
              <dd>{result.booking.origin.name}</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>{result.booking.destination.name}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatDateTime(result.booking.pickupAt)}</dd>
            </div>
            <FareDetails booking={result.booking} />
            <div>
              <dt>Email updates</dt>
              <dd>
                <EmailDeliveryStatus booking={result.booking} />
              </dd>
            </div>
          </dl>
          {result.booking.whatsappConsentAt && (
            <section>
              <h3>WhatsApp updates</h3>
              {result.booking.whatsappOptOutAt ? (
                <p>WhatsApp updates stopped for this ride. Email updates continue.</p>
              ) : (
                <form
                  className="stack-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (cancelling) return;
                    setCancelling(true);
                    setError("");
                    try {
                      const updated = await apiFetch<{ booking: typeof result.booking }>(
                        `/bookings/status/${token}/whatsapp`,
                        { method: "POST", body: { email: phone } },
                      );
                      setResult({ ...result, booking: updated.booking });
                    } catch (failure) {
                      setError(
                        failure instanceof Error ? failure.message : "Could not stop updates.",
                      );
                    } finally {
                      setCancelling(false);
                    }
                  }}
                >
                  <p>
                    Optional updates go to {result.booking.whatsappNumber} when WhatsApp is
                    connected.
                  </p>
                  <label>
                    Request email to stop WhatsApp updates
                    <input
                      type="email"
                      required
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                  <button className="button button-secondary" type="submit" disabled={cancelling}>
                    Stop WhatsApp updates
                  </button>
                </form>
              )}
            </section>
          )}
          <ScheduleChanges booking={result.booking} />
          <ol className="timeline">
            {result.booking.events.map((event) => (
              <li
                key={`${event.createdAt}-${event.toStatus}`}
                className={event.toStatus === result.booking.status ? "active" : ""}
              >
                <strong>{statusLabel(event.toStatus)}</strong>
                <span>{formatDateTime(event.createdAt)}</span>
                <span>
                  {event.actor === "owner"
                    ? "Admin"
                    : event.actor === "customer"
                      ? "Customer"
                      : "System"}
                  {event.reason ? `: ${event.reason}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {result.booking.rejectionReason && (
            <Message tone="info">Reason: {result.booking.rejectionReason}</Message>
          )}
          {result.booking.status === "rejected" && (
            <a className="button button-primary" href="/">
              Make a new request
            </a>
          )}
          {!["completed", "cancelled", "rejected"].includes(result.booking.status) && (
            <form className="cancel-form" onSubmit={handleCancel}>
              <h3>Need to cancel?</h3>
              <label>
                {result.booking.email ? "Request email" : "Booking phone"}
                <input
                  type={result.booking.email ? "email" : "tel"}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                />
              </label>
              <label>
                Reason
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Plans changed"
                  required
                />
              </label>
              <button className="button button-danger" type="submit" disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel this booking"}
              </button>
            </form>
          )}
        </section>
      )}
      <p>
        <a href="/my-requests">My requests</a>
      </p>
    </main>
  );
}

function statusMessage(status: string): string {
  const messages: Record<string, string> = {
    confirmed: "Your ride is confirmed at the agreed fare shown below.",
    picked_up: "Your driver has picked you up.",
    arrived: "You have arrived at your destination.",
    completed: "Trip complete. Thank you for riding with us.",
    cancelled: "This booking was cancelled.",
    requested:
      "Pending approval. Your ride is confirmed only after the admin accepts it. If unanswered at pickup time, the request is automatically rejected.",
    rejected: "This request was not accepted. Check the reason below; you can make a new request.",
  };
  return messages[status] ?? "Your trip status is updating.";
}
