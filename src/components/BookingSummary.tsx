import type { Booking } from "../../shared/contracts";
import { formatDateTime, statusLabel } from "../format";
import { FareDetails } from "./FareDetails";
import { Message } from "./Message";
import { EmailDeliveryStatus } from "./EmailDeliveryStatus";

interface BookingSummaryProps {
  booking: Booking;
  statusUrl: string;
  onNewBooking: () => void;
}

export function BookingSummary({ booking, statusUrl, onNewBooking }: BookingSummaryProps) {
  return (
    <section className="confirmation-card" aria-labelledby="confirmation-title">
      <div className="eyebrow">Request received</div>
      <h1 id="confirmation-title">
        {booking.status === "requested" ? "Pending approval." : "Your request is saved."}
      </h1>
      <Message tone="success">
        {booking.status === "requested"
          ? "Your request is saved. Your ride is confirmed only after the admin accepts it. Unanswered requests are automatically rejected at pickup time."
          : "Check the current decision in your request details."}
      </Message>
      <div className="reference">{booking.reference}</div>
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <span className="status-pill">{statusLabel(booking.status)}</span>
          </dd>
        </div>
        <FareDetails booking={booking} />
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
          <dt>Email updates</dt>
          <dd>
            <EmailDeliveryStatus booking={booking} />
          </dd>
        </div>
      </dl>
      <div className="action-row">
        <a className="button button-primary" href={statusUrl}>
          View request details
        </a>
      </div>
      <button className="text-button" type="button" onClick={onNewBooking}>
        Request another ride
      </button>
      <p>
        <a href="/my-requests">View all my requests by email</a>
      </p>
    </section>
  );
}
