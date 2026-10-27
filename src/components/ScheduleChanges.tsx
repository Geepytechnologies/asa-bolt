import type { Booking } from "../../shared/contracts";
import { formatDateTime } from "../format";

export function ScheduleChanges({ booking }: { booking: Booking }) {
  const events = (booking.scheduleEvents ?? []).filter(
    (event) => event.fromPickupAt !== event.toPickupAt,
  );
  if (!events.length) return null;
  return (
    <section className="schedule-history">
      <h3>Schedule changes</h3>
      <ol className="timeline">
        {events.map((event) => (
          <li key={event.id}>
            <strong>Pickup rescheduled</strong>
            <span>{formatDateTime(event.createdAt)} · Admin</span>
            <span>
              {formatDateTime(event.fromPickupAt)} → {formatDateTime(event.toPickupAt)}
            </span>
            <span>Reason: {event.reason}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
