import { useRef, useState } from "react";
import type { Booking, OperatingSchedule, ScheduleException } from "../../shared/contracts";
import {
  localPickupParts,
  OCCUPIED_STATUSES,
  pickupIsOpen,
  findRideConflicts,
} from "../../shared/scheduling";
import { apiFetch } from "../api";
import { formatDateTime, statusLabel } from "../format";
import { Message } from "./Message";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const initialWindow = {
  id: "new",
  dayOfWeek: "1",
  startTime: "06:30",
  endTime: "21:00",
  active: true,
};
const today = () => localPickupParts(new Date().toISOString()).date;

export function SchedulingPanel({
  token,
  bookings,
  schedules,
  exceptions,
  onSaved,
  onOpenRequest,
}: {
  token: string;
  bookings: Booking[];
  schedules: OperatingSchedule[];
  exceptions: ScheduleException[];
  onSaved: () => Promise<void>;
  onOpenRequest: (id: string) => void;
}) {
  const [window, setWindow] = useState(initialWindow);
  const [closure, setClosure] = useState({ date: today(), note: "" });
  const [date, setDate] = useState("");
  const [includePast, setIncludePast] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = bookings.filter((booking) => OCCUPIED_STATUSES.includes(booking.status));
  const pastCount = active.filter(
    (booking) => localPickupParts(booking.pickupAt).date < today(),
  ).length;
  const visible = active
    .filter(
      (booking) =>
        (!date || localPickupParts(booking.pickupAt).date === date) &&
        (includePast ||
          booking.status !== "confirmed" ||
          localPickupParts(booking.pickupAt).date >= today()),
    )
    .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const currentPage = Math.min(page, pages - 1);
  async function save(path: string, body: unknown, message: string, reset?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(path, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      await onSaved();
      reset?.();
      setNotice(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save this schedule change.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const impact = active.filter((booking) => !pickupIsOpen(booking.pickupAt, schedules, exceptions));
  return (
    <section className="owner-content scheduling-content">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Dispatch planning · Africa/Lagos</div>
          <h2>Schedule</h2>
        </div>
        <span className="count-badge">{active.length} active rides</span>
      </div>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      <h3>Upcoming accepted rides</h3>
      <p>
        Possible scheduling conflicts flag other active rides on the same Lagos pickup date. Review
        their times and decide whether the rides can be accommodated. Duration estimates will be
        added later.
      </p>
      {impact.length > 0 && (
        <Message tone="info">
          {impact.length} accepted or in-progress ride(s) have pickup times outside the current open
          hours or on closed dates. They remain saved; manage each ride to reschedule or cancel it.
        </Message>
      )}
      <div className="action-row">
        <label>
          Show pickup date
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setDate("");
            setPage(0);
          }}
        >
          All upcoming dates
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includePast}
            onChange={(event) => {
              setIncludePast(event.target.checked);
              setPage(0);
            }}
          />
          Include past pickups{pastCount ? ` (${pastCount})` : ""}
        </label>
      </div>
      <p aria-live="polite">{visible.length} matching accepted / in-progress rides</p>
      {!visible.length ? (
        <Message tone="info">No accepted rides for this selection.</Message>
      ) : (
        <div className="upcoming-rides">
          {visible.slice(currentPage * 20, (currentPage + 1) * 20).map((booking) => {
            const conflicts = findRideConflicts(booking, bookings);
            return (
              <article className="upcoming-ride" key={booking.id}>
                <div className="section-heading">
                  <strong>{booking.reference}</strong>
                  <span className="status-pill">{statusLabel(booking.status)}</span>
                </div>
                <p>
                  {booking.origin.name} → {booking.destination.name}
                </p>
                <p>{formatDateTime(booking.pickupAt)}</p>
                {conflicts.length > 0 && (
                  <p className="inline-warning">
                    Possible scheduling conflict: also scheduled on this date —{" "}
                    {conflicts.map((item) => item.reference).join(", ")}.
                  </p>
                )}
                {!pickupIsOpen(booking.pickupAt, schedules, exceptions) && (
                  <p className="inline-warning">Outside current pickup availability.</p>
                )}
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onOpenRequest(booking.id)}
                >
                  Manage ride
                </button>
              </article>
            );
          })}
        </div>
      )}
      {visible.length > 20 && (
        <div className="action-row pagination">
          <button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
      <h3>Weekly pickup hours</h3>
      <p>
        Active windows control new requests, acceptance, and new pickup times. Editing them does not
        move or cancel accepted rides. Multiple separate windows are supported on the same day.
      </p>
      <div className="data-list">
        {schedules.map((item) => (
          <div key={item.id}>
            <strong>{item.dayLabel}</strong>
            <span>
              {item.startTime}–{item.endTime} · {item.active ? "Active" : "Inactive"}
            </span>
            <span className="action-row">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setWindow({
                    id: item.id,
                    dayOfWeek: String(item.dayOfWeek),
                    startTime: item.startTime,
                    endTime: item.endTime,
                    active: item.active,
                  });
                  document
                    .getElementById("pickup-window-editor")
                    ?.scrollIntoView({ block: "start" });
                }}
              >
                Edit window
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void save(
                    `/owner/schedules/${item.id}`,
                    { ...item, active: !item.active },
                    `Pickup window ${item.active ? "disabled" : "enabled"}. Accepted rides remain saved.`,
                  )
                }
              >
                {item.active ? "Disable" : "Enable"}
              </button>
            </span>
          </div>
        ))}
      </div>
      <form
        id="pickup-window-editor"
        className="stack-form scheduling-card"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            `/owner/schedules/${window.id}`,
            { ...window, dayOfWeek: Number(window.dayOfWeek) },
            "Pickup hours saved. Review any accepted rides outside the new hours.",
            () => setWindow(initialWindow),
          );
        }}
      >
        <h4>{window.id === "new" ? "Add pickup window" : "Edit pickup window"}</h4>
        <fieldset className="plain-fieldset" disabled={busy}>
          <div className="form-grid">
            <label>
              Day
              <select
                value={window.dayOfWeek}
                onChange={(event) => setWindow({ ...window, dayOfWeek: event.target.value })}
              >
                {days.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Opens
              <input
                type="time"
                value={window.startTime}
                required
                onChange={(event) => setWindow({ ...window, startTime: event.target.value })}
              />
            </label>
            <label>
              Closes
              <input
                type="time"
                value={window.endTime}
                required
                onChange={(event) => setWindow({ ...window, endTime: event.target.value })}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={window.active}
              onChange={(event) => setWindow({ ...window, active: event.target.checked })}
            />
            Active for pickups
          </label>
          <p className="muted">
            Opening and closing times must be on the same day. Active windows cannot overlap. The
            closing time itself is outside the pickup window.
          </p>
          <div className="action-row">
            <button type="submit" className="button button-primary">
              Save pickup window
            </button>
            {window.id !== "new" && (
              <button
                type="button"
                className="text-button"
                onClick={() => setWindow(initialWindow)}
              >
                Add a new window instead
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <h3>Closed dates</h3>
      <div className="data-list">
        {!exceptions.length ? (
          <p>No date closures configured.</p>
        ) : (
          exceptions.map((item) => {
            const count = active.filter(
              (booking) => localPickupParts(booking.pickupAt).date === item.date,
            ).length;
            return (
              <div key={item.id}>
                <strong>
                  {item.date} · {item.closed ? "Closed" : "Reopened"}
                </strong>
                <span>
                  {item.note}
                  {count ? ` · ${count} accepted / in-progress ride(s) remain scheduled` : ""}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void save(
                      `/owner/exceptions/${item.id}`,
                      { ...item, closed: !item.closed },
                      `${item.date} ${item.closed ? "reopened under weekly pickup hours" : "closed for new pickups"}. Existing rides remain saved.`,
                    )
                  }
                >
                  {item.closed ? "Reopen date" : "Close date again"}
                </button>
              </div>
            );
          })
        )}
      </div>
      <form
        className="stack-form scheduling-card"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            "/owner/exceptions/new",
            { ...closure, closed: true },
            "Date closed. Accepted rides remain saved; manage any affected rides separately.",
            () => setClosure({ ...closure, note: "" }),
          );
        }}
      >
        <fieldset className="plain-fieldset" disabled={busy}>
          <div className="form-grid">
            <label>
              Date to close
              <input
                type="date"
                value={closure.date}
                required
                onChange={(event) => setClosure({ ...closure, date: event.target.value })}
              />
            </label>
            <label>
              Closure reason
              <input
                value={closure.note}
                required
                maxLength={240}
                onChange={(event) => setClosure({ ...closure, note: event.target.value })}
              />
            </label>
          </div>
          <button type="submit" className="button button-secondary">
            Close date
          </button>
        </fieldset>
      </form>
    </section>
  );
}
