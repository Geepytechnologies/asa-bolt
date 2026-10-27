import { useState } from "react";
import type { ConflictReview } from "../../shared/contracts";
import { formatDateTime } from "../format";

export function ConflictNotice({
  review,
  busy,
  action,
  onConfirm,
  onCancel,
}: {
  review: ConflictReview;
  busy: boolean;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <section className="conflict-notice" aria-label="Possible scheduling conflicts" role="alert">
      <h4>Possible scheduling conflict</h4>
      <p>
        Other accepted or in-progress rides share this pickup date in Africa/Lagos. Durations are
        not estimated, so these are possible conflicts. Review the times and decide whether you can
        accept this ride.
      </p>
      <ul>
        {review.conflicts.map((conflict) => (
          <li key={conflict.id}>
            <strong>{conflict.reference}</strong> · {conflict.route}
            <br />
            {formatDateTime(conflict.pickupAt)}
            <br />
            <span>
              {conflict.kind === "same_pickup"
                ? "Same pickup time"
                : "Same pickup date; check availability"}
            </span>
          </li>
        ))}
      </ul>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={busy}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I have reviewed the possible conflicts and can accommodate the ride.
      </label>
      <div className="action-row">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !acknowledged}
          onClick={onConfirm}
        >
          {busy ? "Saving…" : action}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Go back
        </button>
      </div>
    </section>
  );
}
