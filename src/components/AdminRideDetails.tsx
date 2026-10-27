import { useRef, useState } from "react";
import type { Booking, ConflictReview } from "../../shared/contracts";
import { localPickupParts } from "../../shared/scheduling";
import { ApiError, apiFetch } from "../api";
import { formatDateTime, statusLabel } from "../format";
import { ConflictNotice } from "./ConflictNotice";
import { Message } from "./Message";
import { ScheduleChanges } from "./ScheduleChanges";
import { EMAIL_STATE_LABELS } from "../../shared/notifications";

export function AdminRideDetails({
  booking,
  token,
  onSaved,
}: {
  booking: Booking;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const local = localPickupParts(booking.pickupAt);
  const [pickup, setPickup] = useState(`${local.date}T${local.time}`);
  const [revision, setRevision] = useState(booking.scheduleRevision ?? 0);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<ConflictReview>();
  const [preview, setPreview] = useState<ConflictReview>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const canEdit = ["requested", "confirmed"].includes(booking.status);
  const body = () => ({
    pickupAt: new Date(`${pickup}:00+01:00`).toISOString(),
    expectedRevision: revision,
    reason,
  });
  function clearReview() {
    setReview(undefined);
    setPreview(undefined);
    setError("");
    setNotice("");
  }
  async function check() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setPreview(
        await apiFetch<ConflictReview>(`/owner/bookings/${booking.id}/schedule-preview`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: body(),
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not check this schedule.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(conflictToken?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ booking: Booking }>(
        `/owner/bookings/${booking.id}/schedule`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: { ...body(), conflictToken },
        },
      );
      const updated = localPickupParts(result.booking.pickupAt);
      setPickup(`${updated.date}T${updated.time}`);
      setRevision(result.booking.scheduleRevision ?? 0);
      setReason("");
      setPreview(undefined);
      setReview(undefined);
      setNotice(
        "Schedule saved. Pickup changes send a customer update; the saved fare is preserved.",
      );
      await onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.review) setReview(error.review);
      else {
        if (error instanceof ApiError && error.status === 409) await onSaved();
        setError(error instanceof Error ? error.message : "Could not save the schedule.");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="admin-ride-details" aria-label={`Details for ${booking.reference}`}>
      <h3>Request details</h3>
      <dl className="detail-list">
        <div>
          <dt>Customer</dt>
          <dd>{booking.email || `${booking.customerName} · ${booking.phone}`}</dd>
        </div>
        {booking.whatsappConsentAt && (
          <div>
            <dt>WhatsApp preference</dt>
            <dd>
              {booking.whatsappOptOutAt
                ? `Stopped ${formatDateTime(booking.whatsappOptOutAt)}`
                : `${booking.whatsappNumber} · opted in ${formatDateTime(booking.whatsappConsentAt)}`}
            </dd>
          </div>
        )}
        <div>
          <dt>Requested</dt>
          <dd>{formatDateTime(booking.createdAt)}</dd>
        </div>
        <div>
          <dt>Pickup note</dt>
          <dd>{booking.pickupNote || "None"}</dd>
        </div>
        <div>
          <dt>Latest customer email</dt>
          <dd>
            {booking.customerEmailStatus
              ? EMAIL_STATE_LABELS[booking.customerEmailStatus]
              : booking.email
                ? "No detailed delivery record (older request)"
                : "No email on this older request"}
            . Open Notifications to view attempts and retry failed emails by reference.
          </dd>
        </div>
        {booking.fare.pricing && (
          <div>
            <dt>Quote calculation</dt>
            <dd>
              {booking.fare.pricing.method === "fixed"
                ? `Fixed price ₦${booking.fare.pricing.fixedAmountNaira}`
                : `${booking.fare.pricing.distanceKm} km × ₦${booking.fare.pricing.ratePerKm}/km`}{" "}
              · rounded up in ₦50 steps
              {booking.fare.pricing.rateSource === "area" && (
                <span className="offer-entered">
                  Area rate · {booking.fare.pricing.pricingAreaName}
                </span>
              )}
              {booking.fare.pricing.rateSource === "default" && (
                <span className="offer-entered">
                  Default rate
                  {booking.fare.pricing.pricingAreaName
                    ? ` · ${booking.fare.pricing.pricingAreaName} had no area rate`
                    : ""}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>
      <a
        href={`/status/${encodeURIComponent(booking.accessToken)}`}
        target="_blank"
        rel="noreferrer"
      >
        Open customer request details ↗
      </a>
      <h4>Status history</h4>
      <ol className="timeline">
        {booking.events.map((event, index) => (
          <li key={`${event.createdAt}-${index}`}>
            <strong>{statusLabel(event.toStatus)}</strong>
            <span>
              {formatDateTime(event.createdAt)} ·{" "}
              {event.actor === "owner"
                ? "Admin"
                : event.actor === "customer"
                  ? "Customer"
                  : "System"}
            </span>
            {event.reason && <span>{event.reason}</span>}
          </li>
        ))}
      </ol>
      <ScheduleChanges booking={booking} />
      {canEdit && (
        <>
          <h3>Edit ride schedule</h3>
          <p>
            Times use Africa/Lagos. Pickup changes require an open future time and send the reason
            to the customer. Prices and approval status stay the same.
          </p>
          <p className="muted">
            Warnings compare active rides on the same pickup date. They indicate possible conflicts,
            not confirmed overlaps. Duration estimates are deferred.
          </p>
          {revision !== (booking.scheduleRevision ?? 0) && (
            <Message tone="info">
              This ride was changed by another admin. Load the current schedule before saving your
              next change.
            </Message>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              const current = localPickupParts(booking.pickupAt);
              setPickup(`${current.date}T${current.time}`);
              setRevision(booking.scheduleRevision ?? 0);
              setReason("");
              clearReview();
            }}
          >
            Load current schedule
          </button>
          {error && <Message tone="error">{error}</Message>}
          {notice && <Message tone="success">{notice}</Message>}
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <div className="form-grid">
                <label>
                  New pickup (Nigeria)
                  <input
                    type="datetime-local"
                    value={pickup}
                    required
                    onChange={(event) => {
                      setPickup(event.target.value);
                      clearReview();
                    }}
                  />
                </label>
              </div>
              <label>
                Schedule-change reason
                <input
                  value={reason}
                  minLength={3}
                  maxLength={240}
                  required
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReview(undefined);
                  }}
                />
              </label>
              <div className="action-row">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!pickup}
                  onClick={() => void check()}
                >
                  Check possible conflicts
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={revision !== (booking.scheduleRevision ?? 0)}
                >
                  {busy ? "Saving…" : "Save ride schedule"}
                </button>
              </div>
            </fieldset>
          </form>
          {preview && (
            <div className="schedule-preview" aria-live="polite">
              <p>
                {preview.conflicts.length
                  ? `${preview.conflicts.length} other active ride(s) share this pickup date. Review these possible conflicts.`
                  : "No other accepted or in-progress rides are scheduled on this Lagos pickup date. No duration or travel-time estimate is assumed."}
              </p>
              {preview.conflicts.map((item) => (
                <p key={item.id}>
                  {item.reference} · {item.route} · {formatDateTime(item.pickupAt)}
                </p>
              ))}
            </div>
          )}
          {review && (
            <ConflictNotice
              key={review.token}
              review={review}
              busy={busy}
              action="Reschedule after review"
              onConfirm={() => void save(review.token)}
              onCancel={() => setReview(undefined)}
            />
          )}
        </>
      )}
    </section>
  );
}
