import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND_CONFIG } from "../../shared/config";
import type {
  Booking,
  FareRule,
  LocationRequest,
  OperatingSchedule,
  ScheduleException,
  ServiceLocation,
} from "../../shared/contracts";
import { ApiError, apiFetch, type OwnerSnapshot } from "../api";
import { statusLabel } from "../format";
import { PricingPanel } from "./PricingPanel";
import { RequestsPanel } from "./RequestsPanel";
import { SchedulingPanel } from "./SchedulingPanel";
import { Message } from "./Message";
import { NotificationsCenter } from "./NotificationsCenter";
import { CalendarPanel } from "./CalendarPanel";

interface OwnerPageProps {
  onBack: () => void;
}
type OwnerTab =
  "queue" | "schedule" | "locations" | "fares" | "requests" | "notifications" | "calendar";
const defaultLocation = {
  id: "new",
  name: "",
  landmark: "",
  mapsUrl: "",
  coordinates: "",
  published: false,
};

export function OwnerPage({ onBack }: OwnerPageProps) {
  const [token, setToken] = useState(() => localStorage.getItem("asa-bolt-owner-token") ?? "");
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<OwnerSnapshot>();
  const [tab, setTab] = useState<OwnerTab>(() =>
    new URLSearchParams(window.location.search).has("calendar") ? "calendar" : "queue",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [location, setLocation] = useState(defaultLocation);
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
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setError("Your admin session has ended. Sign in again.");
        setToken("");
        setSnapshot(undefined);
        localStorage.removeItem("asa-bolt-owner-token");
      } else setError("Could not refresh the admin data. Check your connection and try Refresh.");
    }
  }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    void loadSnapshot(token).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadSnapshot, token]);
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ token: string }>("/owner/login", {
        method: "POST",
        body: { password },
      });
      localStorage.setItem("asa-bolt-owner-token", result.token);
      setToken(result.token);
      setPassword("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not sign in. Try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function handleLogout() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await apiFetch("/owner/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 401)) {
        setError("Could not sign out. Check your connection and try again.");
        return;
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
    localStorage.removeItem("asa-bolt-owner-token");
    setToken("");
    setSnapshot(undefined);
    setNotice("");
  }
  async function handleReview(event: React.MouseEvent<HTMLButtonElement>) {
    const status = event.currentTarget.dataset.status ?? "";
    const id = event.currentTarget.dataset.id ?? "";
    if (!token || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/owner/location-requests/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          status,
          responseNote:
            status === "approved"
              ? "Location published. A served route and price are still required for booking."
              : "Not added to served locations.",
        },
      });
      await loadSnapshot(token);
      setNotice(`Location request ${status}.`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not review this location request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function handleLocationSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/owner/locations/${location.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: location,
      });
      setLocation(defaultLocation);
      await loadSnapshot(token);
      setNotice("Location saved.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this location.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!token)
    return (
      <main className="narrow-page owner-login">
        <button className="text-button" type="button" onClick={onBack}>
          ← Customer booking
        </button>
        <div className="eyebrow">Private dispatch desk</div>
        <h1>Admin sign-in</h1>
        {error && <Message tone="error">{error}</Message>}
        <form className="stack-form" onSubmit={handleLogin}>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to dashboard"}
          </button>
        </form>
      </main>
    );
  const bookings = snapshot?.bookings ?? [];
  return (
    <main className="owner-shell" aria-busy={busy || loading}>
      <header className="owner-header">
        <div>
          <div className="eyebrow">{BRAND_CONFIG.name} / dispatch</div>
          <h1>Admin portal</h1>
        </div>
        <div className="action-row">
          <button className="button button-secondary" type="button" onClick={onBack}>
            Customer view
          </button>
          <button
            className="text-button"
            type="button"
            disabled={busy || loading}
            onClick={() => void loadSnapshot(token)}
          >
            Refresh
          </button>
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            Sign out
          </button>
        </div>
      </header>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      {loading && <Message tone="info">Loading admin data…</Message>}
      <nav className="tab-nav" aria-label="Admin sections">
        {(
          [
            "queue",
            "schedule",
            "locations",
            "fares",
            "requests",
            "notifications",
            "calendar",
          ] as OwnerTab[]
        ).map((item) => (
          <button
            className={tab === item ? "active" : ""}
            aria-current={tab === item ? "page" : undefined}
            type="button"
            key={item}
            onClick={() => {
              setTab(item);
              setNotice("");
            }}
          >
            {tabTitle(item)}
          </button>
        ))}
      </nav>
      {snapshot && (
        <>
          {tab === "queue" && (
            <RequestsPanel
              token={token}
              bookings={bookings}
              schedules={snapshot.schedules}
              exceptions={snapshot.exceptions}
              selectedId={selectedRequestId}
              onSaved={() => loadSnapshot(token)}
            />
          )}
          {tab === "schedule" && (
            <SchedulingPanel
              token={token}
              bookings={bookings}
              schedules={snapshot.schedules}
              exceptions={snapshot.exceptions}
              onSaved={() => loadSnapshot(token)}
              onOpenRequest={(id) => {
                setSelectedRequestId(id);
                setTab("queue");
              }}
            />
          )}
          {tab === "locations" && (
            <LocationPanel
              locations={snapshot.locations}
              value={location}
              onChange={setLocation}
              onEdit={(item) =>
                setLocation({
                  id: item.id,
                  name: item.name,
                  landmark: item.landmark,
                  mapsUrl: item.mapsUrl,
                  coordinates: item.coordinates,
                  published: item.published,
                })
              }
              onSave={handleLocationSave}
            />
          )}
          {tab === "fares" && (
            <PricingPanel token={token} onSaved={() => void loadSnapshot(token)} />
          )}
          {tab === "requests" && (
            <RequestPanel requests={snapshot.requests} onReview={handleReview} />
          )}
          {tab === "notifications" && (
            <NotificationsCenter token={token} onSaved={() => loadSnapshot(token)} />
          )}
          {tab === "calendar" && <CalendarPanel token={token} />}
        </>
      )}
    </main>
  );
}

function LocationPanel({
  locations,
  value,
  onChange,
  onSave,
  onEdit,
}: {
  locations: ServiceLocation[];
  value: typeof defaultLocation;
  onChange: (value: typeof defaultLocation) => void;
  onEdit: (location: ServiceLocation) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="owner-content">
      <div className="section-heading">
        <div className="eyebrow">Route catalogue</div>
        <h2>Service locations</h2>
      </div>
      <div className="data-list">
        {locations.map((item) => (
          <div key={item.id}>
            <strong>{item.name}</strong>
            <span>
              {item.landmark}
              {item.researchId ? ` · Research ${item.researchId}` : ""}
            </span>
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
            <button
              type="button"
              className="text-button"
              onClick={() => {
                onEdit(item);
                document.getElementById("location-editor")?.scrollIntoView({ block: "start" });
              }}
            >
              Edit location
            </button>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h3>{value.id === "new" ? "Add a location" : "Edit location"}</h3>
        <button type="button" className="text-button" onClick={() => onChange(defaultLocation)}>
          New location
        </button>
      </div>
      <form id="location-editor" className="stack-form" onSubmit={onSave}>
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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.published}
            onChange={(event) => onChange({ ...value, published: event.target.checked })}
          />
          Published for customers
        </label>
        <p className="muted">
          Customers can choose published locations only when a published route connects them. Hiding
          a location also makes its routes unavailable.
        </p>
        <button className="button button-primary" type="submit">
          Save location
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

function tabTitle(tab: OwnerTab): string {
  if (tab === "fares") return "Pricing & routes";
  return tab === "queue"
    ? "Requests"
    : tab === "requests"
      ? "Location requests"
      : tab[0].toUpperCase() + tab.slice(1);
}
