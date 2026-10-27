import { useEffect, useRef, useState } from "react";
import { BOOKING_STATUSES } from "../../shared/config";
import type {
  Booking,
  ConflictReview,
  OperatingSchedule,
  ScheduleException,
} from "../../shared/contracts";
import { findRideConflicts, localPickupParts, pickupIsOpen } from "../../shared/scheduling";
import { ApiError, apiFetch } from "../api";
import { formatDateTime, formatNaira, statusLabel } from "../format";
import { AdminRideDetails } from "./AdminRideDetails";
import { ConflictNotice } from "./ConflictNotice";
import { FareDetails } from "./FareDetails";
import { Message } from "./Message";

export function RequestsPanel({
  token,
  bookings,
  schedules,
  exceptions,
  selectedId,
  onSaved,
}: {
  token: string;
  bookings: Booking[];
  schedules: OperatingSchedule[];
  exceptions: ScheduleException[];
  selectedId: string;
  onSaved: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(() =>
    selectedId
      ? Math.max(0, Math.floor(bookings.findIndex((item) => item.id === selectedId) / 20))
      : 0,
  );
  const [expanded, setExpanded] = useState(selectedId);
  const [reasonId, setReasonId] = useState("");
  const [reason, setReason] = useState("");
  const [pendingReview, setPendingReview] = useState<{ id: string; review: ConflictReview }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selectedArticle = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    selectedArticle.current?.scrollIntoView({ block: "start" });
    selectedArticle.current?.focus({ preventScroll: true });
  }, [selectedId]);
  const search = query.trim().toLowerCase();
  const invalidRange = Boolean(from && to && from > to);
  const filtered = bookings.filter((booking) => {
    const date = localPickupParts(booking.pickupAt).date;
    return (
      !invalidRange &&
      (!status || booking.status === status) &&
      (!from || date >= from) &&
      (!to || date <= to) &&
      (!search ||
        [booking.email ?? "", booking.reference, booking.phone].some((value) =>
          value.toLowerCase().includes(search),
        ))
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages - 1);
  async function update(id: string, nextStatus: string, conflictToken?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/owner/bookings/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          status: nextStatus,
          reason: ["cancelled", "rejected"].includes(nextStatus) ? reason : "",
          conflictToken,
        },
      });
      setPendingReview(undefined);
      setReasonId("");
      setReason("");
      await onSaved();
      setNotice("Request updated.");
    } catch (error) {
      if (error instanceof ApiError && error.review) setPendingReview({ id, review: error.review });
      else {
        if (error instanceof ApiError && error.status === 409) await onSaved();
        setError(error instanceof Error ? error.message : "The request could not be updated.");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function clear() {
    setQuery("");
    setStatus("");
    setFrom("");
    setTo("");
    setPage(0);
  }
  return (
    <section className="owner-content" aria-busy={busy}>
      <div className="section-heading">
        <div>
          <div className="eyebrow">Operations</div>
          <h2>Ride requests</h2>
        </div>
        <span className="count-badge">{bookings.length} total</span>
      </div>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      <div className="request-filters">
        <label className="request-search">
          Search email, reference or phone
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {BOOKING_STATUSES.map((item) => (
              <option key={item} value={item}>
                {statusLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pickup from
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Pickup through
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <div className="section-heading">
        <p aria-live="polite">
          {filtered.length} matching {filtered.length === 1 ? "request" : "requests"} · pickup dates
          use Africa/Lagos
        </p>
        <button type="button" className="text-button" onClick={clear}>
          Clear filters
        </button>
      </div>
      {invalidRange && (
        <Message tone="error">The end date must be on or after the start date.</Message>
      )}
      {!filtered.length ? (
        <Message tone="info">
          {bookings.length
            ? "No requests match these filters. Clear or change the filters to see more."
            : "New requests will appear here."}
        </Message>
      ) : (
        <div className="booking-table">
          {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map((booking) => {
            const conflicts =
              booking.status === "requested" ? findRideConflicts(booking, bookings) : [];
            const next =
              booking.status === "requested"
                ? "confirmed"
                : booking.status === "confirmed"
                  ? "picked_up"
                  : booking.status === "picked_up"
                    ? "arrived"
                    : booking.status === "arrived"
                      ? "completed"
                      : "";
            const pending = pendingReview?.id === booking.id ? pendingReview.review : undefined;
            return (
              <article
                className="booking-row"
                key={booking.id}
                id={`ride-${booking.id}`}
                ref={booking.id === selectedId ? selectedArticle : undefined}
                tabIndex={-1}
              >
                <div className="booking-row-main">
                  <span className="reference-small">{booking.reference}</span>
                  <strong>
                    {booking.origin.name} → {booking.destination.name}
                  </strong>
                  <span className="muted">
                    {booking.email || `${booking.customerName} · ${booking.phone}`} ·{" "}
                    {formatDateTime(booking.pickupAt)}
                  </span>
                  <dl className="detail-list request-fares">
                    <FareDetails booking={booking} />
                  </dl>
                  {booking.rejectionReason && <span>Reason: {booking.rejectionReason}</span>}
                  {booking.cancellationReason && (
                    <span>Cancellation: {booking.cancellationReason}</span>
                  )}
                  {conflicts.length > 0 && (
                    <p className="inline-warning">
                      Possible scheduling conflict: {conflicts.length} other accepted or in-progress
                      ride(s) share this pickup date. Review their times before acceptance.
                    </p>
                  )}
                  {booking.status === "confirmed" &&
                    !pickupIsOpen(booking.pickupAt, schedules, exceptions) && (
                      <p className="inline-warning">
                        This accepted pickup is outside the current open hours or on a closed date.
                        Reschedule or cancel it separately.
                      </p>
                    )}
                </div>
                <span className="status-pill">{statusLabel(booking.status)}</span>
                <div className="action-row compact">
                  {next && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => void update(booking.id, next)}
                    >
                      {next === "confirmed"
                        ? booking.offer
                          ? `Accept offer · ${formatNaira(booking.offer.roundedAmountKobo)}`
                          : "Accept request"
                        : statusLabel(next)}
                    </button>
                  )}
                  {booking.status === "requested" && (
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => {
                        setReasonId(`rejected:${booking.id}`);
                        setReason("");
                        setPendingReview(undefined);
                      }}
                    >
                      {booking.offer ? "Reject offer" : "Reject request"}
                    </button>
                  )}
                  {!["completed", "cancelled", "rejected"].includes(booking.status) && (
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => {
                        setReasonId(`cancelled:${booking.id}`);
                        setReason("");
                        setPendingReview(undefined);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    aria-expanded={expanded === booking.id}
                    onClick={() => setExpanded(expanded === booking.id ? "" : booking.id)}
                  >
                    {expanded === booking.id ? "Hide details" : "View details & schedule"}
                  </button>
                </div>
                {reasonId.endsWith(`:${booking.id}`) && (
                  <form
                    className="cancel-box"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void update(
                        booking.id,
                        reasonId.startsWith("rejected:") ? "rejected" : "cancelled",
                      );
                    }}
                  >
                    <label>
                      {reasonId.startsWith("rejected:")
                        ? "Rejection reason"
                        : "Cancellation reason"}
                      <input
                        required
                        minLength={3}
                        maxLength={240}
                        disabled={busy}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <button type="submit" className="button button-danger" disabled={busy}>
                      {reasonId.startsWith("rejected:")
                        ? "Confirm rejection"
                        : "Confirm cancellation"}
                    </button>
                  </form>
                )}
                {pending && (
                  <ConflictNotice
                    key={pending.token}
                    review={pending}
                    busy={busy}
                    action="Accept ride after review"
                    onConfirm={() => void update(booking.id, "confirmed", pending.token)}
                    onCancel={() => setPendingReview(undefined)}
                  />
                )}
                {expanded === booking.id && (
                  <AdminRideDetails
                    key={booking.id}
                    booking={booking}
                    token={token}
                    onSaved={onSaved}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
      {filtered.length > 20 && (
        <div className="action-row pagination">
          <button
            type="button"
            className="button button-secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {pages}
          </span>
          <button
            type="button"
            className="button button-secondary"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
