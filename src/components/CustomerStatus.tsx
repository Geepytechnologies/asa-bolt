import { useCallback, useEffect, useState } from "react";
import type { BookingAccessResponse } from "../../shared/contracts";
import { cancelBooking, fetchBookingStatus } from "../api";
import { formatDateTime, formatNaira, statusLabel } from "../format";
import { Message } from "./Message";

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
        const result = await cancelBooking(token, phone, reason);
        setResult((current) => (current ? { ...current, booking: result.booking } : current));
        setReason("");
      } catch {
        setError("Cancellation needs the phone number used for booking and a short reason.");
      } finally {
        setCancelling(false);
      }
    },
    [phone, reason, token],
  );
  return (
    <main className="narrow-page">
      <button className="text-button back-button" type="button" onClick={onBack}>
        ← Back to booking
      </button>
      <div className="eyebrow">Live trip status</div>
      <h1>{result?.booking.reference ?? "Your booking"}</h1>
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
            <div>
              <dt>Fare snapshot</dt>
              <dd>{formatNaira(result.booking.fare.amountKobo)}</dd>
            </div>
          </dl>
          <ol className="timeline">
            {result.booking.events.map((event) => (
              <li
                key={`${event.createdAt}-${event.toStatus}`}
                className={event.toStatus === result.booking.status ? "active" : ""}
              >
                <strong>{statusLabel(event.toStatus)}</strong>
                <span>{formatDateTime(event.createdAt)}</span>
              </li>
            ))}
          </ol>
          {!["completed", "cancelled"].includes(result.booking.status) && (
            <form className="cancel-form" onSubmit={handleCancel}>
              <h3>Need to cancel?</h3>
              <label>
                Booking phone
                <input
                  type="tel"
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
    </main>
  );
}

function statusMessage(status: string): string {
  const messages: Record<string, string> = {
    confirmed: "Your ride is confirmed. Keep your phone close.",
    picked_up: "Your driver has picked you up.",
    arrived: "You have arrived at your destination.",
    completed: "Trip complete. Thank you for riding with us.",
    cancelled: "This booking was cancelled.",
    requested: "Your request is being reviewed.",
  };
  return messages[status] ?? "Your trip status is updating.";
}
