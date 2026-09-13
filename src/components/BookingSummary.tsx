import type { Booking } from "../../shared/contracts";
import { formatDateTime, formatNaira, statusLabel } from "../format";
import { Message } from "./Message";

interface BookingSummaryProps {
  booking: Booking;
  statusUrl: string;
  onNewBooking: () => void;
}

export function BookingSummary({ booking, statusUrl, onNewBooking }: BookingSummaryProps) {
  return (
    <section className="confirmation-card" aria-labelledby="confirmation-title">
      <div className="eyebrow">Booking secured</div>
      <h2 id="confirmation-title">You are on the road.</h2>
      <Message tone="success">
        Your ride was automatically confirmed because the selected time is available.
      </Message>
      <div className="reference">{booking.reference}</div>
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <span className="status-pill">{statusLabel(booking.status)}</span>
          </dd>
        </div>
        <div>
          <dt>Fare</dt>
          <dd>{formatNaira(booking.fare.amountKobo)}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{formatDateTime(booking.pickupAt)}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>
            {booking.origin.name} <span aria-hidden="true">→</span> {booking.destination.name}
          </dd>
        </div>
        <div>
          <dt>Notifications</dt>
          <dd>
            {booking.notificationStatus === "queued"
              ? "Console adapter queued (local)"
              : booking.notificationStatus}
          </dd>
        </div>
      </dl>
      <div className="action-row">
        <a className="button button-primary" href={statusUrl}>
          View live status
        </a>
      </div>
      <button className="text-button" type="button" onClick={onNewBooking}>
        Book another ride
      </button>
    </section>
  );
}
