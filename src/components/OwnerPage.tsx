import { useCallback, useEffect, useState } from "react";
import { BRAND_CONFIG } from "../../shared/config";
import type {
  Booking,
  FareRule,
  LocationRequest,
  OperatingSchedule,
  ScheduleException,
  ServiceLocation,
} from "../../shared/contracts";
import { apiFetch, type OwnerSnapshot } from "../api";
import { formatDateTime, formatNaira, statusLabel } from "../format";
import { Message } from "./Message";

interface OwnerPageProps {
  onBack: () => void;
}
type OwnerTab = "queue" | "schedule" | "locations" | "fares" | "requests";
const defaultSchedule = { dayOfWeek: "1", startTime: "06:30", endTime: "21:00" };
const defaultLocation = { name: "", landmark: "", mapsUrl: "" };
const defaultFare = {
  originId: "",
  destinationId: "",
  amount: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
};

export function OwnerPage({ onBack }: OwnerPageProps) {
  const [token, setToken] = useState(() => localStorage.getItem("asa-bolt-owner-token") ?? "");
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<OwnerSnapshot>();
  const [tab, setTab] = useState<OwnerTab>("queue");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelId, setCancelId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [schedule, setSchedule] = useState(defaultSchedule);
  const [exception, setException] = useState({
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [location, setLocation] = useState(defaultLocation);
  const [fare, setFare] = useState(defaultFare);
  const loadSnapshot = useCallback(async (sessionToken: string) => {
    try {
      const headers = { Authorization: `Bearer ${sessionToken}` };
      const [bookings, schedules, exceptions, locations, fares, requests] = await Promise.all([
        apiFetch<Booking[]>("/owner/bookings", { headers }),
        apiFetch<OperatingSchedule[]>("/owner/schedules", { headers }),
        apiFetch<ScheduleException[]>("/owner/exceptions", { headers }),
        apiFetch<ServiceLocation[]>("/owner/locations", { headers }),
        apiFetch<FareRule[]>("/owner/fare-rules", { headers }),
        apiFetch<LocationRequest[]>("/owner/location-requests", { headers }),
      ]);
      setSnapshot({ bookings, schedules, exceptions, locations, fares, requests });
      setError("");
    } catch {
      setError("Your owner session is unavailable. Sign in again.");
      setToken("");
      localStorage.removeItem("asa-bolt-owner-token");
    }
  }, []);
  useEffect(() => {
    if (token) void loadSnapshot(token);
  }, [loadSnapshot, token]);
  const handleLogin = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError("");
      try {
        const result = await apiFetch<{ token: string }>("/owner/login", {
          method: "POST",
          body: { password },
        });
        localStorage.setItem("asa-bolt-owner-token", result.token);
        setToken(result.token);
        await loadSnapshot(result.token);
      } catch {
        setError("That password did not work. Check the local owner password and try again.");
      }
    },
    [loadSnapshot, password],
  );
  const handleLogout = useCallback(() => {
    localStorage.removeItem("asa-bolt-owner-token");
    setToken("");
    setSnapshot(undefined);
  }, []);
  const handleStatus = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const status = event.currentTarget.dataset.status ?? "";
      const id = event.currentTarget.dataset.id ?? "";
      if (!status || !id || !token) return;
      setError("");
      try {
        await apiFetch(`/owner/bookings/${id}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: { status, reason: status === "cancelled" ? cancelReason : "" },
        });
        setNotice("Booking status updated.");
        setCancelId("");
        setCancelReason("");
        await loadSnapshot(token);
      } catch {
        setError("Status update failed. A cancellation must include a reason.");
      }
    },
    [cancelReason, loadSnapshot, token],
  );
  const handleReview = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const status = event.currentTarget.dataset.status ?? "";
      const id = event.currentTarget.dataset.id ?? "";
      if (!token) return;
      try {
        await apiFetch(`/owner/location-requests/${id}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: {
            status,
            responseNote:
              status === "approved"
                ? "Added to the published locations."
                : "Not added in this release.",
          },
        });
        setNotice(`Location request ${status}.`);
        await loadSnapshot(token);
      } catch {
        setError("That location request could not be updated.");
      }
    },
    [loadSnapshot, token],
  );
  const handleScheduleSave = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) return;
      try {
        await apiFetch("/owner/schedules/new", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: {
            ...schedule,
            dayOfWeek: Number(schedule.dayOfWeek),
            active: true,
          },
        });
        setNotice("Schedule saved.");
        await loadSnapshot(token);
      } catch {
        setError("Schedule could not be saved.");
      }
    },
    [loadSnapshot, schedule, token],
  );
  const handleLocationSave = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) return;
      try {
        await apiFetch("/owner/locations/new", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: { ...location, published: true, coordinates: "" },
        });
        setLocation(defaultLocation);
        setNotice("Location published.");
        await loadSnapshot(token);
      } catch {
        setError("Location could not be saved.");
      }
    },
    [loadSnapshot, location, token],
  );
  const handleFareSave = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) return;
      try {
        await apiFetch("/owner/fare-rules/new", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: { ...fare, amountKobo: Number(fare.amount) * 100, active: true },
        });
        setNotice("Fare rule saved with a history entry.");
        await loadSnapshot(token);
      } catch {
        setError("Fare rule could not be saved.");
      }
    },
    [fare, loadSnapshot, token],
  );
  const handleExceptionSave = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) return;
      try {
        await apiFetch("/owner/exceptions/new", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: { ...exception, closed: true },
        });
        setNotice("Closed date saved.");
        await loadSnapshot(token);
      } catch {
        setError("Closed date could not be saved.");
      }
    },
    [exception, loadSnapshot, token],
  );
  if (!token)
    return (
      <main className="narrow-page owner-login">
        <button className="text-button" type="button" onClick={onBack}>
          ← Customer booking
        </button>
        <div className="eyebrow">Private dispatch desk</div>
        <h1>Owner sign-in</h1>
        {error && <Message tone="error">{error}</Message>}
        <form className="stack-form" onSubmit={handleLogin}>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="button button-primary" type="submit">
            Sign in to dashboard
          </button>
        </form>
      </main>
    );
  const bookings = snapshot?.bookings ?? [];
  return (
    <main className="owner-shell">
      <header className="owner-header">
        <div>
          <div className="eyebrow">{BRAND_CONFIG.name} / dispatch</div>
          <h1>Good morning, owner.</h1>
        </div>
        <div className="action-row">
          <button className="button button-secondary" type="button" onClick={onBack}>
            Customer view
          </button>
          <button className="text-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      <nav className="tab-nav" aria-label="Owner sections">
        {(["queue", "schedule", "locations", "fares", "requests"] as OwnerTab[]).map((item) => (
          <button
            className={tab === item ? "active" : ""}
            type="button"
            key={item}
            onClick={() => setTab(item)}
          >
            {tabTitle(item)}
          </button>
        ))}
      </nav>
      {tab === "queue" && (
        <BookingQueue
          bookings={bookings}
          cancelId={cancelId}
          cancelReason={cancelReason}
          onCancelId={setCancelId}
          onCancelReason={setCancelReason}
          onStatus={handleStatus}
        />
      )}
      {tab === "schedule" && (
        <SchedulePanel
          schedules={snapshot?.schedules ?? []}
          exceptions={snapshot?.exceptions ?? []}
          exception={exception}
          value={schedule}
          onChange={setSchedule}
          onExceptionChange={setException}
          onExceptionSave={handleExceptionSave}
          onSave={handleScheduleSave}
        />
      )}
      {tab === "locations" && (
        <LocationPanel
          locations={snapshot?.locations ?? []}
          value={location}
          onChange={setLocation}
          onSave={handleLocationSave}
        />
      )}
      {tab === "fares" && (
        <FarePanel
          fares={snapshot?.fares ?? []}
          locations={snapshot?.locations ?? []}
          value={fare}
          onChange={setFare}
          onSave={handleFareSave}
        />
      )}
      {tab === "requests" && (
        <RequestPanel requests={snapshot?.requests ?? []} onReview={handleReview} />
      )}
    </main>
  );
}

function BookingQueue({
  bookings,
  cancelId,
  cancelReason,
  onCancelId,
  onCancelReason,
  onStatus,
}: {
  bookings: Booking[];
  cancelId: string;
  cancelReason: string;
  onCancelId: (value: string) => void;
  onCancelReason: (value: string) => void;
  onStatus: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section className="owner-content">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Operations</div>
          <h2>Booking queue</h2>
        </div>
        <span className="count-badge">{bookings.length} total</span>
      </div>
      {bookings.length === 0 ? (
        <Message tone="info">New bookings will appear here.</Message>
      ) : (
        <div className="booking-table">
          {bookings.map((booking) => (
            <article className="booking-row" key={booking.id}>
              <div className="booking-row-main">
                <span className="reference-small">{booking.reference}</span>
                <strong>
                  {booking.origin.name} → {booking.destination.name}
                </strong>
                <span className="muted">
                  {booking.customerName} · {booking.phone} · {formatDateTime(booking.pickupAt)}
                </span>
              </div>
              <span className="status-pill">{statusLabel(booking.status)}</span>
              <div className="action-row compact">
                {nextStatus(booking.status).map((status) => (
                  <button
                    className="button button-secondary"
                    data-id={booking.id}
                    data-status={status}
                    key={status}
                    type="button"
                    onClick={onStatus}
                  >
                    {statusLabel(status)}
                  </button>
                ))}
                {booking.status !== "cancelled" && booking.status !== "completed" && (
                  <button
                    className="button button-danger"
                    type="button"
                    onClick={(event) => onCancelId(event.currentTarget.dataset.id ?? "")}
                    data-id={booking.id}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {cancelId === booking.id && (
                <div className="cancel-box">
                  <label>
                    Cancellation reason
                    <input
                      value={cancelReason}
                      onChange={(event) => onCancelReason(event.target.value)}
                      required
                    />
                  </label>
                  <button
                    className="button button-danger"
                    data-id={booking.id}
                    data-status="cancelled"
                    type="button"
                    onClick={onStatus}
                  >
                    Confirm cancellation
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SchedulePanel({
  schedules,
  exceptions,
  exception,
  value,
  onChange,
  onExceptionChange,
  onExceptionSave,
  onSave,
}: {
  schedules: OperatingSchedule[];
  exceptions: ScheduleException[];
  exception: { date: string; note: string };
  value: typeof defaultSchedule;
  onChange: (value: typeof defaultSchedule) => void;
  onExceptionChange: (value: { date: string; note: string }) => void;
  onExceptionSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="owner-content">
      <div className="section-heading">
        <div className="eyebrow">Availability</div>
        <h2>Operating schedules</h2>
      </div>
      <div className="data-list">
        {schedules.map((item) => (
          <div key={item.id}>
            <strong>{item.dayLabel}</strong>
            <span>
              {item.startTime} – {item.endTime}
            </span>
            <span>{item.active ? "Open" : "Closed"}</span>
          </div>
        ))}
      </div>
      <h3>Add or replace a schedule</h3>
      <form className="inline-form" onSubmit={onSave}>
        <label>
          Day
          <select
            value={value.dayOfWeek}
            onChange={(event) => onChange({ ...value, dayOfWeek: event.target.value })}
          >
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
              (day, index) => (
                <option value={index} key={day}>
                  {day}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Opens
          <input
            type="time"
            value={value.startTime}
            onChange={(event) => onChange({ ...value, startTime: event.target.value })}
          />
        </label>
        <label>
          Closes
          <input
            type="time"
            value={value.endTime}
            onChange={(event) => onChange({ ...value, endTime: event.target.value })}
          />
        </label>
        <button className="button button-primary" type="submit">
          Save schedule
        </button>
      </form>
      <h3>Closed dates</h3>
      <div className="data-list">
        {exceptions.length === 0 ? (
          <span className="muted">No closed dates configured.</span>
        ) : (
          exceptions.map((item) => (
            <div key={item.id}>
              <strong>{item.date}</strong>
              <span>{item.note}</span>
              <span>{item.closed ? "Closed" : "Open"}</span>
            </div>
          ))
        )}
      </div>
      <form className="inline-form" onSubmit={onExceptionSave}>
        <label>
          Date
          <input
            type="date"
            value={exception.date}
            onChange={(event) => onExceptionChange({ ...exception, date: event.target.value })}
            required
          />
        </label>
        <label>
          Reason
          <input
            value={exception.note}
            onChange={(event) => onExceptionChange({ ...exception, note: event.target.value })}
            required
          />
        </label>
        <button className="button button-secondary" type="submit">
          Close date
        </button>
      </form>
    </section>
  );
}

function LocationPanel({
  locations,
  value,
  onChange,
  onSave,
}: {
  locations: ServiceLocation[];
  value: typeof defaultLocation;
  onChange: (value: typeof defaultLocation) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="owner-content">
      <div className="section-heading">
        <div className="eyebrow">Route catalogue</div>
        <h2>Published locations</h2>
      </div>
      <div className="data-list">
        {locations.map((item) => (
          <div key={item.id}>
            <strong>{item.name}</strong>
            <span>{item.landmark}</span>
            <span>
              {item.published ? "Published" : "Hidden"}
              {item.mapsUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a href={item.mapsUrl} target="_blank" rel="noreferrer">
                    Map ↗
                  </a>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      <h3>Publish a location</h3>
      <form className="stack-form" onSubmit={onSave}>
        <label>
          Name
          <input
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            required
          />
        </label>
        <label>
          Landmark
          <input
            value={value.landmark}
            onChange={(event) => onChange({ ...value, landmark: event.target.value })}
            required
          />
        </label>
        <label>
          Google Maps URL <span className="muted">(optional)</span>
          <input
            name="mapsUrl"
            type="url"
            value={value.mapsUrl}
            onChange={(event) => onChange({ ...value, mapsUrl: event.target.value })}
          />
        </label>
        <button className="button button-primary" type="submit">
          Publish location
        </button>
      </form>
    </section>
  );
}

function FarePanel({
  fares,
  locations,
  value,
  onChange,
  onSave,
}: {
  fares: FareRule[];
  locations: ServiceLocation[];
  value: typeof defaultFare;
  onChange: (value: typeof defaultFare) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="owner-content">
      <div className="section-heading">
        <div className="eyebrow">Pricing</div>
        <h2>Fare rules</h2>
      </div>
      <div className="data-list">
        {fares.map((item) => (
          <div key={`${item.id}-${item.effectiveFrom}`}>
            <strong>
              {item.originName} → {item.destinationName}
            </strong>
            <span>{formatNaira(item.amountKobo)}</span>
            <span>From {item.effectiveFrom}</span>
          </div>
        ))}
      </div>
      <h3>Add a route fare</h3>
      <form className="stack-form" onSubmit={onSave}>
        <label>
          Origin
          <select
            value={value.originId}
            onChange={(event) => onChange({ ...value, originId: event.target.value })}
            required
          >
            <option value="">Choose</option>
            {locations.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Destination
          <select
            value={value.destinationId}
            onChange={(event) => onChange({ ...value, destinationId: event.target.value })}
            required
          >
            <option value="">Choose</option>
            {locations.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount in naira
          <input
            type="number"
            min="0"
            value={value.amount}
            onChange={(event) => onChange({ ...value, amount: event.target.value })}
            required
          />
        </label>
        <label>
          Effective from
          <input
            type="date"
            value={value.effectiveFrom}
            onChange={(event) => onChange({ ...value, effectiveFrom: event.target.value })}
            required
          />
        </label>
        <button className="button button-primary" type="submit">
          Save fare rule
        </button>
      </form>
    </section>
  );
}

function RequestPanel({
  requests,
  onReview,
}: {
  requests: LocationRequest[];
  onReview: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section className="owner-content">
      <div className="section-heading">
        <div className="eyebrow">Customer voice</div>
        <h2>Location requests</h2>
      </div>
      {requests.length === 0 ? (
        <Message tone="info">No location requests yet.</Message>
      ) : (
        <div className="booking-table">
          {requests.map((request) => (
            <article className="booking-row" key={request.id}>
              <div className="booking-row-main">
                <span className="reference-small">{statusLabel(request.status)}</span>
                <strong>{request.locationName}</strong>
                <span className="muted">
                  {request.landmark} · {request.requesterName} · {request.phone}
                </span>
              </div>
              {request.status === "pending" && (
                <div className="action-row compact">
                  <button
                    className="button button-primary"
                    data-id={request.id}
                    data-status="approved"
                    type="button"
                    onClick={onReview}
                  >
                    Approve & publish
                  </button>
                  <button
                    className="button button-danger"
                    data-id={request.id}
                    data-status="declined"
                    type="button"
                    onClick={onReview}
                  >
                    Decline
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function nextStatus(status: string): string[] {
  const map: Record<string, string[]> = {
    requested: ["confirmed"],
    confirmed: ["picked_up"],
    picked_up: ["arrived"],
    arrived: ["completed"],
  };
  return map[status] ?? [];
}
function tabTitle(tab: OwnerTab): string {
  return tab === "queue"
    ? "Bookings"
    : tab === "requests"
      ? "Location requests"
      : tab[0].toUpperCase() + tab.slice(1);
}
