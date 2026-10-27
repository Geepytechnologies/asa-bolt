import { useEffect, useState } from "react";
import type { CalendarChoice, CalendarOverview } from "../../shared/calendar";
import { CALENDAR_STATE_LABELS } from "../../shared/calendar";
import { apiFetch } from "../api";
import { formatDateTime } from "../format";
import { Message } from "./Message";

export function CalendarPanel({ token }: { token: string }) {
  const [data, setData] = useState<CalendarOverview>();
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => {
    const result = new URLSearchParams(window.location.search).get("calendar");
    return result === "connected"
      ? "Google account connected. Choose the calendar that should receive rides."
      : "";
  });
  const [disconnecting, setDisconnecting] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("calendar");
    if (result === "failed")
      setError(
        "Google Calendar could not be connected. Sign in and try again; check server credentials and Google permissions if it continues.",
      );
    if (result) {
      const url = new URL(window.location.href);
      url.searchParams.delete("calendar");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  useEffect(() => {
    let active = true;
    apiFetch<CalendarOverview>("/owner/calendar", { headers: { Authorization: `Bearer ${token}` } })
      .then((value) => {
        if (active) {
          setData(value);
          setSelected(value.calendarId);
        }
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function refresh() {
    const result = await apiFetch<CalendarOverview>(
      `/owner/calendar?q=${encodeURIComponent(query)}`,
      { headers },
    );
    setData(result);
    return result;
  }
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="owner-content">
        <h2>Calendar</h2>
        {error ? <Message tone="error">{error}</Message> : <p>Loading calendar settings…</p>}
        {error && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await refresh();
              })
            }
          >
            Retry loading calendar
          </button>
        )}
      </section>
    );
  return (
    <section className="owner-content" aria-busy={busy}>
      <div className="section-heading">
        <div>
          <div className="eyebrow">Accepted rides</div>
          <h2>Google Calendar</h2>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await refresh();
            })
          }
        >
          Refresh calendar updates
        </button>
      </div>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      <p>
        Accepted rides become private pickup markers in your chosen Google calendar. Rescheduling
        and cancellation update the same event. Manage rides in Asa Ride; changes made in Google do
        not change bookings here.
      </p>
      <p className="muted">
        Pickup markers use Lagos time and do not reserve a ride duration or affect Google’s
        free/busy schedule. Calendar access is separate from customer email; customers are not
        invited to events.
      </p>
      <section className="pricing-card" aria-label="Google Calendar connection">
        <h3>
          {!data.configured
            ? "Not configured"
            : !data.connected
              ? "Not connected"
              : data.ready
                ? "Calendar linked"
                : "Choose a calendar"}
        </h3>
        {!data.configured ? (
          <>
            <p>
              You can configure Google Calendar later. Booking requests and admin decisions continue
              to work; calendar updates wait for setup.
            </p>
            <p>Add these settings securely on the server:</p>
            <ul>
              {data.missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </>
        ) : !data.connected ? (
          <p>
            Connect the Google account that owns or can edit your dispatch calendar, then choose
            that calendar.
          </p>
        ) : (
          <p>
            Google account: {data.account}.{" "}
            {data.calendarName
              ? `Calendar: ${data.calendarName}.`
              : "No destination calendar selected yet."}
          </p>
        )}
        <p className="muted">
          Last successful access check:{" "}
          {data.lastCheckedAt ? formatDateTime(data.lastCheckedAt) : "Not checked yet"}. Stored
          credentials alone do not confirm current Google access.
        </p>
        {data.lastError && <Message tone="error">{data.lastError}</Message>}
        <details>
          <summary>Google setup callback address</summary>
          <p className="calendar-address">{data.callbackUrl}</p>
          <p>
            Register this exact address for the server’s Google OAuth web client. Client secrets and
            encrypted access tokens stay on the server.
          </p>
        </details>
        <div className="action-row">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !data.configured}
            onClick={() =>
              void act(async () => {
                const result = await apiFetch<{ url: string }>("/owner/calendar/connect", {
                  method: "POST",
                  headers,
                  body: {},
                });
                const target = new URL(result.url);
                if (target.origin !== "https://accounts.google.com")
                  throw new Error("Invalid Google authorization address.");
                window.location.assign(target.href);
              })
            }
          >
            {data.connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
          </button>
          {data.connected && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const values = await apiFetch<CalendarChoice[]>("/owner/calendar/calendars", {
                    headers,
                  });
                  setCalendars(values);
                  setSelected(
                    data.calendarId || values.find((c) => c.primary)?.id || values[0]?.id || "",
                  );
                  await refresh();
                  setNotice("Google access checked. Choose a writable calendar below.");
                })
              }
            >
              Check connection & load calendars
            </button>
          )}
          {(data.connected || data.account) && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setDisconnecting(true)}
            >
              Disconnect calendar
            </button>
          )}
        </div>
        {disconnecting && (
          <section aria-label="Confirm calendar disconnect" className="notification-confirm">
            <h4>Disconnect Google Calendar?</h4>
            <p>
              Existing Google events stay in place. Further updates wait until the same account and
              calendar are reconnected. An update already being sent may still finish.
            </p>
            <div className="action-row">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await apiFetch("/owner/calendar/disconnect", {
                      method: "POST",
                      headers,
                      body: { expectedRevision: data.revision },
                    });
                    setCalendars([]);
                    setDisconnecting(false);
                    await refresh();
                    setNotice(
                      "Calendar disconnected. Saved rides and existing Google events are unchanged.",
                    );
                  })
                }
              >
                Confirm calendar disconnect
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setDisconnecting(false)}
              >
                Keep connected
              </button>
            </div>
          </section>
        )}
        {calendars.length > 0 && data.connected && (
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                await apiFetch("/owner/calendar/settings", {
                  method: "PATCH",
                  headers,
                  body: { calendarId: selected, expectedRevision: data.revision },
                });
                await refresh();
                setNotice(
                  "Calendar saved. Upcoming accepted rides and queued changes will sync automatically.",
                );
              });
            }}
          >
            <label>
              Ride calendar
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                disabled={busy}
                required
              >
                <option value="">Choose a calendar</option>
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                    {calendar.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Choose a dedicated dispatch calendar if available. Once ride events have synced, keep
              the same destination so reschedules and cancellations update the original events.
            </p>
            <button type="submit" className="button button-primary" disabled={busy || !selected}>
              Save ride calendar
            </button>
          </form>
        )}
      </section>
      <section aria-label="Calendar updates">
        <h3>Calendar updates</h3>
        <p>
          {data.counts.awaiting_setup} awaiting setup · {data.counts.queued + data.counts.syncing}{" "}
          pending · {data.counts.failed} failed · {data.counts.synced} synced ·{" "}
          {data.counts.cancelled} cancelled
        </p>
        <form
          className="pricing-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await refresh();
            });
          }}
        >
          <label>
            Search calendar updates by reference
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="submit" className="button button-secondary" disabled={busy}>
            Search updates
          </button>
        </form>
        <p className="muted">
          Showing up to 100 matching updates, newest first. A calendar failure never undoes an
          accepted ride. Retries reconcile the latest saved change using the same event ID.
        </p>
        <div className="data-list">
          {data.updates.length ? (
            data.updates.map((update) => (
              <article key={update.bookingId} className="notification-record">
                <div className="section-heading">
                  <strong>{update.reference}</strong>
                  <span className="status-pill">{CALENDAR_STATE_LABELS[update.status]}</span>
                </div>
                <p>
                  {update.attempts} attempt(s) · {formatDateTime(update.updatedAt)}
                </p>
                {update.lastError && <p className="inline-warning">{update.lastError}</p>}
                {update.retryable && (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await apiFetch(`/owner/calendar/updates/${update.bookingId}/retry`, {
                          method: "POST",
                          headers,
                          body: { expectedRevision: update.revision },
                        });
                        await refresh();
                        setNotice(
                          "The latest calendar update is queued for retry. The booking is unchanged.",
                        );
                      })
                    }
                  >
                    Retry calendar update for {update.reference}
                  </button>
                )}
              </article>
            ))
          ) : (
            <Message tone="info">
              No calendar updates yet. Pending or rejected requests do not create events.
            </Message>
          )}
        </div>
      </section>
    </section>
  );
}
function message(failure: unknown) {
  return failure instanceof Error
    ? failure.message
    : "Calendar settings could not be loaded. Try again.";
}
