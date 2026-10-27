import { useEffect, useState } from "react";
import type { RequestHistory } from "../../shared/contracts";
import {
  ApiError,
  closeRequestHistory,
  fetchRequestHistory,
  requestHistoryLink,
  verifyHistoryLink,
} from "../api";
import { formatDateTime, statusLabel } from "../format";
import { FareDetails } from "./FareDetails";
import { Message } from "./Message";

export function MyRequestsPage() {
  const [linkToken, setLinkToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [email, setEmail] = useState("");
  const [history, setHistory] = useState<RequestHistory>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    function readIncomingLink() {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (!token) return;
      window.history.replaceState(null, "", window.location.pathname);
      setHistory(undefined);
      setError("");
      setNotice("");
      setLinkToken(token);
    }
    window.addEventListener("hashchange", readIncomingLink);
    return () => window.removeEventListener("hashchange", readIncomingLink);
  }, []);

  useEffect(() => {
    if (linkToken) {
      window.history.replaceState(null, "", window.location.pathname);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetchRequestHistory()
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((failure) => {
        if (active && (!(failure instanceof ApiError) || failure.status !== 401))
          setError("We could not load your requests. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [linkToken]);

  useEffect(() => {
    if (!history) return;
    const timer = window.setTimeout(
      () => {
        setHistory(undefined);
        setError("Your private session has expired. Request a new email link.");
      },
      Math.max(0, history.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [history]);

  async function sendLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await requestHistoryLink(email);
      setNotice(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We could not send a private link.");
    } finally {
      setBusy(false);
    }
  }

  async function openLink() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await verifyHistoryLink(linkToken);
      setLinkToken("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We could not open this link.");
      if (failure instanceof ApiError && failure.status === 401) setLinkToken("");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await closeRequestHistory();
      setHistory(undefined);
      setEmail("");
      setNotice("Your private session is closed.");
      setError("");
    } catch {
      setError("We could not close your session. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="narrow-page history-page">
      <div className="eyebrow">Private request history</div>
      <h1>My requests</h1>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      {loading && <Message tone="info">Checking your private session…</Message>}
      {!loading && linkToken && (
        <section className="status-card">
          <h2>Open your requests</h2>
          <p>This email link can be used once. Your private session lasts 30 minutes.</p>
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={openLink}
          >
            {busy ? "Verifying link…" : "Open my requests"}
          </button>
        </section>
      )}
      {!loading && !linkToken && !history && (
        <section className="status-card">
          <h2>Get a private link</h2>
          <p>
            Enter your email. We’ll send a link that expires in 15 minutes. Your requests appear
            only after you open that link.
          </p>
          <form className="stack-form" onSubmit={sendLink}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "Sending link…" : "Email me a private link"}
            </button>
          </form>
        </section>
      )}
      {!loading && history && !linkToken && (
        <>
          <div className="history-heading">
            <p>
              Requests for <strong>{history.email}</strong>
              <br />
              <span className="muted">
                Private access ends {formatDateTime(new Date(history.expiresAt).toISOString())}.
              </span>
            </p>
            <button className="text-button" type="button" disabled={busy} onClick={logout}>
              Close private session
            </button>
          </div>
          {history.bookings.length === 0 ? (
            <Message tone="info">No ride requests for this email yet.</Message>
          ) : (
            <div className="history-list">
              {history.bookings.map((booking) => (
                <article className="history-card" key={booking.id}>
                  <div className="section-heading">
                    <h2>{booking.reference}</h2>
                    <span className="status-pill">{statusLabel(booking.status)}</span>
                  </div>
                  <p>
                    {booking.origin.name} → {booking.destination.name}
                  </p>
                  <dl className="detail-list">
                    <div>
                      <dt>Pickup</dt>
                      <dd>{formatDateTime(booking.pickupAt)}</dd>
                    </div>
                    <FareDetails booking={booking} />
                  </dl>
                  {(booking.scheduleEvents ?? [])
                    .filter((event) => event.fromPickupAt !== event.toPickupAt)
                    .slice(-1)
                    .map((event) => (
                      <p key={event.id}>Rescheduled by the admin: {event.reason}</p>
                    ))}
                  {booking.rejectionReason && <p>Reason: {booking.rejectionReason}</p>}
                  <a
                    className="button button-secondary"
                    href={`/status/${encodeURIComponent(booking.accessToken)}`}
                  >
                    View request details
                  </a>
                </article>
              ))}
            </div>
          )}
          <p>
            <a className="button button-primary" href="/">
              Request a ride
            </a>
          </p>
        </>
      )}
    </main>
  );
}
