import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMAIL_EVENTS,
  EMAIL_EVENT_LABELS,
  EMAIL_STATES,
  EMAIL_STATE_LABELS,
  type EmailDelivery,
  type EmailDeliveryDetail,
  type EmailEvent,
  type NotificationOverview,
  type NotificationSettings,
} from "../../shared/notifications";
import { ApiError, apiFetch } from "../api";
import { formatDateTime } from "../format";
import { Message } from "./Message";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The notification request could not be completed.";

export function NotificationsPanel({
  token,
  onSaved,
  channel = "email",
}: {
  token: string;
  channel?: "email" | "whatsapp";
  onSaved: () => Promise<void>;
}) {
  const endpoint = channel === "email" ? "/owner/notifications" : "/owner/whatsapp-notifications";
  const label = channel === "email" ? "Email" : "WhatsApp";
  const [data, setData] = useState<NotificationOverview>();
  const [draft, setDraft] = useState<NotificationSettings>();
  const [recipients, setRecipients] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<EmailDeliveryDetail>();
  const [confirmation, setConfirmation] = useState<EmailDelivery>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const lock = useRef(false);
  const requestNumber = useRef(0);
  const initialized = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++requestNumber.current;
      const params = new URLSearchParams({ q: query, status, page: String(page) });
      const result = await apiFetch<NotificationOverview>(`${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (request === requestNumber.current && !signal?.aborted) {
        setData(result);
        if (!initialized.current) {
          initialized.current = true;
          setDraft(result.settings);
          setRecipients(result.settings.adminRecipients.join("\n"));
        }
      }
      return result;
    },
    [token, query, status, page, endpoint],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void load(controller.signal)
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) setError(errorText(failure));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, refresh]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await apiFetch<NotificationSettings>(`${endpoint}/settings`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          ...draft,
          adminRecipients: recipients
            .split(/[,;\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      setDraft(saved);
      setRecipients(saved.adminRecipients.join("\n"));
      setNotice(
        "Notification settings saved. They apply to future events; retrying an existing message keeps its original recipient and message.",
      );
      await load();
    } catch (failure) {
      setError(errorText(failure));
      if (failure instanceof ApiError && failure.status === 409)
        await load().catch(() => undefined);
      if (failure instanceof ApiError && failure.status === 401) await onSaved();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function showDetail(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setDetail(
        await apiFetch<EmailDeliveryDetail>(`${endpoint}/deliveries/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    if (!confirmation || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<EmailDeliveryDetail>(
        `${endpoint}/deliveries/${confirmation.id}/retry`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: { expectedAttempts: confirmation.attempts },
        },
      );
      setDetail(result);
      setConfirmation(undefined);
      if (result.delivery.status === "failed" || result.delivery.status === "uncertain")
        setError(
          `Retry recorded: ${EMAIL_STATE_LABELS[result.delivery.status]}. ${result.delivery.lastError}`,
        );
      else
        setNotice(
          `Retry recorded: ${EMAIL_STATE_LABELS[result.delivery.status]}. The ride and its fare were not changed.`,
        );
      await Promise.all([load(), onSaved()]);
    } catch (failure) {
      setError(errorText(failure));
      setConfirmation(undefined);
      await load().catch(() => undefined);
      if (failure instanceof ApiError && failure.status === 401) await onSaved();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function updateEvent(
    event: EmailEvent,
    key: "customerEnabled" | "adminEnabled" | "message",
    value: boolean | string,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            events: { ...current.events, [event]: { ...current.events[event], [key]: value } },
          }
        : current,
    );
  }
  return (
    <section className="owner-content notification-content" aria-busy={busy || loading}>
      <div className="section-heading">
        <div>
          <div className="eyebrow">Customer and dispatch updates</div>
          <h2>{label} notifications</h2>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setError("");
            setRefresh((value) => value + 1);
          }}
        >
          Refresh deliveries
        </button>
      </div>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      {loading && <Message tone="info">Loading notification records…</Message>}
      {!data && !loading && (
        <p>Notification records could not be loaded. Use Refresh deliveries to try again.</p>
      )}
      {data && (
        <>
          <section className="notification-connection" aria-label={`${label} connection`}>
            <h3>{label} connection</h3>
            <p>{data.connection.message}</p>
            <p>
              Last recorded attempt:{" "}
              {data.connection.lastAttemptAt
                ? `${formatDateTime(data.connection.lastAttemptAt)} · ${EMAIL_STATE_LABELS[data.connection.lastAttemptStatus!]}`
                : "No attempts yet"}
              .
            </p>
            <p className="muted">
              Connection information reflects server configuration and recorded attempts. Provider
              credentials stay on the server. Provider acceptance does not confirm{" "}
              {channel === "email" ? "inbox" : "handset"} delivery.
            </p>
            {data.connection.mode === "resend" && (
              <p>
                Signed delivery updates:{" "}
                {data.connection.webhooksConfigured
                  ? "Webhook verification is configured."
                  : "Add the Resend webhook signing secret and endpoint to receive delivery and bounce updates."}
              </p>
            )}
            {["resend", "webhook"].includes(data.connection.mode) && (
              <p>
                Safe retry after an uncertain result:{" "}
                {data.connection.idempotentRetries
                  ? `Enabled for the same adapter for ${data.connection.retryWindowMinutes} minutes after the message record is created, using its stable delivery ID.`
                  : "Unavailable until the adapter's idempotency support is verified."}
              </p>
            )}
          </section>
          {draft && (
            <details className="notification-settings">
              <summary>Configure {label} recipients, events and message text</summary>
              <form className="stack-form" onSubmit={(event) => void saveSettings(event)}>
                <div className="section-heading">
                  <h3>{label} settings</h3>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDraft(data.settings);
                      setRecipients(data.settings.adminRecipients.join("\n"));
                    }}
                  >
                    Load saved settings
                  </button>
                </div>
                {draft.revision !== data.settings.revision && (
                  <Message tone="info">
                    Another admin saved newer settings. Load the saved settings before saving your
                    changes.
                  </Message>
                )}
                <fieldset className="plain-fieldset" disabled={busy}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={draft.emailEnabled}
                      onChange={(event) =>
                        setDraft({ ...draft, emailEnabled: event.target.checked })
                      }
                    />
                    Send {label} ride updates
                  </label>
                  <label>
                    Admin recipients
                    <textarea
                      value={recipients}
                      rows={3}
                      maxLength={2600}
                      placeholder={channel === "email" ? "dispatch@example.com" : "+234…"}
                      onChange={(event) => setRecipients(event.target.value)}
                    />
                  </label>
                  <p className="muted">
                    Up to ten {channel === "email" ? "email addresses" : "WhatsApp numbers"},
                    separated by new lines or commas. Each recipient receives one message per event.
                    No admin copies are sent when this list is empty.{" "}
                    {channel === "whatsapp" &&
                      "Only add admin numbers whose owners have agreed to receive updates. Customer messages require their separate opt-in on the ride request."}
                  </p>
                  <p>
                    Choose which ride events notify the customer or admin. Additional message text
                    is plain text; the route, pickup time, saved prices, decision/reason, and
                    private details link remain included.
                  </p>
                  <div className="notification-event-grid">
                    {EMAIL_EVENTS.map((event) => (
                      <section className="notification-event" key={event}>
                        <h4>{EMAIL_EVENT_LABELS[event]}</h4>
                        <div className="action-row">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.events[event].customerEnabled}
                              onChange={(input) =>
                                updateEvent(event, "customerEnabled", input.target.checked)
                              }
                            />
                            Customer · {EMAIL_EVENT_LABELS[event]}
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.events[event].adminEnabled}
                              onChange={(input) =>
                                updateEvent(event, "adminEnabled", input.target.checked)
                              }
                            />
                            Admin · {EMAIL_EVENT_LABELS[event]}
                          </label>
                        </div>
                        <label>
                          Additional text · {EMAIL_EVENT_LABELS[event]}
                          <textarea
                            rows={3}
                            maxLength={1000}
                            value={draft.events[event].message}
                            onChange={(input) => updateEvent(event, "message", input.target.value)}
                          />
                        </label>
                      </section>
                    ))}
                  </div>
                  <p className="muted">
                    {channel === "email"
                      ? "Private history links send only to the requesting email, independently of ride settings. Their short-lived links cannot be replayed here."
                      : "WhatsApp is optional and starts disabled. Enable it after connecting and checking your adapter. Customers can stop WhatsApp updates from their private ride details."}
                  </p>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={draft.revision !== data.settings.revision}
                  >
                    {busy ? "Saving…" : "Save notification settings"}
                  </button>
                </fieldset>
              </form>
            </details>
          )}
          <section className="notification-deliveries" aria-label={`${label} delivery history`}>
            <h3>{label} delivery history</h3>
            <p>
              {data.counts.failed} failed · {data.counts.uncertain} uncertain ·{" "}
              {data.counts.accepted} provider accepted · {data.counts.preview} previews
            </p>
            {channel === "email" && (
              <p>
                {data.counts.delivered} delivered to recipient server · {data.counts.delayed}{" "}
                delayed · {data.counts.bounced} bounced · {data.counts.complained} spam reports ·{" "}
                {data.counts.delivery_failed} provider failures
              </p>
            )}
            <p className="muted">
              Records start when this feature is installed; older notification summaries are not
              reconstructed. Failed sends never undo a saved ride decision. Retry only reattempts
              the selected saved message.
            </p>
            <div className="request-filters">
              <label className="request-search">
                Search {label} recipient or reference
                <input
                  type="search"
                  value={query}
                  maxLength={160}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                    setConfirmation(undefined);
                  }}
                />
              </label>
              <label>
                Delivery status
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(0);
                    setConfirmation(undefined);
                  }}
                >
                  <option value="">All delivery statuses</option>
                  {EMAIL_STATES.filter(
                    (value) =>
                      channel === "email" ||
                      ![
                        "delivered",
                        "delayed",
                        "bounced",
                        "complained",
                        "delivery_failed",
                        "preview",
                      ].includes(value),
                  ).map((value) => (
                    <option key={value} value={value}>
                      {EMAIL_STATE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p aria-live="polite">
              {data.total} matching {label} {data.total === 1 ? "record" : "records"}
            </p>
            <div className="notification-list">
              {!data.deliveries.length ? (
                <Message tone="info">No {label} records match this view.</Message>
              ) : (
                data.deliveries.map((delivery) => (
                  <article className="notification-record" key={delivery.id}>
                    <div className="section-heading">
                      <strong>{delivery.reference || "Private history link"}</strong>
                      <span className="status-pill">{EMAIL_STATE_LABELS[delivery.status]}</span>
                    </div>
                    <p>
                      {delivery.recipient} ·{" "}
                      {delivery.audience === "both"
                        ? "Customer and admin"
                        : delivery.audience === "customer"
                          ? "Customer"
                          : "Admin"}
                    </p>
                    <p>
                      {delivery.event === "history.link"
                        ? "Private history link"
                        : EMAIL_EVENT_LABELS[delivery.event]}{" "}
                      · {formatDateTime(delivery.createdAt)}
                    </p>
                    <p>
                      {delivery.attempts} attempt(s) · last update{" "}
                      {formatDateTime(delivery.updatedAt)}
                    </p>
                    {delivery.lastError && <p className="inline-warning">{delivery.lastError}</p>}
                    {delivery.retryBlockedReason &&
                      ["failed", "uncertain", "queued"].includes(delivery.status) && (
                        <p>{delivery.retryBlockedReason}</p>
                      )}
                    <div className="action-row">
                      <button
                        className="text-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void showDetail(delivery.id)}
                      >
                        View message & attempts
                      </button>
                      {delivery.retryable && (
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setConfirmation(delivery);
                            setError("");
                          }}
                        >
                          {delivery.status === "queued" ? "Send queued message" : "Retry message"}
                        </button>
                      )}
                    </div>
                    {confirmation?.id === delivery.id && (
                      <section className="notification-confirm" aria-label="Confirm message retry">
                        <h4>Retry this saved message?</h4>
                        <p>
                          Send the original message to {confirmation.recipient}. This does not
                          create a request or change its status, schedule, or fare.
                        </p>
                        <div className="action-row">
                          <button
                            className="button button-primary"
                            type="button"
                            disabled={busy}
                            onClick={() => void retry()}
                          >
                            {busy ? "Sending…" : "Confirm message retry"}
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmation(undefined)}
                          >
                            Keep current status
                          </button>
                        </div>
                      </section>
                    )}
                    {detail?.delivery.id === delivery.id &&
                      detail.delivery.attempts === delivery.attempts &&
                      detail.delivery.status === delivery.status && (
                        <section
                          className="notification-detail"
                          aria-label={`Message details ${delivery.id}`}
                        >
                          <h4>{detail.delivery.subject}</h4>
                          {detail.delivery.providerMessageId && (
                            <p>Provider message ID: {detail.delivery.providerMessageId}</p>
                          )}
                          {detail.delivery.event === "history.link" ? (
                            <p>
                              Private verification links are not stored or shown here. Request a
                              fresh link from My requests.
                            </p>
                          ) : (
                            <pre>{detail.text}</pre>
                          )}
                          <h4>Delivery attempts</h4>
                          {!detail.attempts.length ? (
                            <p>No send attempted.</p>
                          ) : (
                            <ol className="timeline">
                              {detail.attempts.map((attempt) => (
                                <li key={attempt.number}>
                                  <strong>
                                    Attempt {attempt.number} · {EMAIL_STATE_LABELS[attempt.status]}
                                  </strong>
                                  <span>
                                    {formatDateTime(attempt.startedAt)} ·{" "}
                                    {attempt.actor === "owner" ? "Admin retry" : "System"}
                                  </span>
                                  {attempt.error && <span>{attempt.error}</span>}
                                </li>
                              ))}
                            </ol>
                          )}
                          {detail.providerEvents.length > 0 && (
                            <>
                              <h4>Verified provider updates</h4>
                              <ol className="timeline">
                                {detail.providerEvents.map((event, index) => (
                                  <li key={`${event.type}-${event.createdAt}-${index}`}>
                                    <strong>{event.type}</strong>
                                    <span>{formatDateTime(event.createdAt)}</span>
                                  </li>
                                ))}
                              </ol>
                            </>
                          )}
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => setDetail(undefined)}
                          >
                            Hide message details
                          </button>
                        </section>
                      )}
                  </article>
                ))
              )}
            </div>
            {data.total > 20 && (
              <div className="action-row pagination">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || loading || !data.page}
                  onClick={() => {
                    setPage(data.page - 1);
                    setConfirmation(undefined);
                  }}
                >
                  Previous email page
                </button>
                <span>
                  Page {data.page + 1} of {Math.ceil(data.total / 20)}
                </span>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || loading || (data.page + 1) * 20 >= data.total}
                  onClick={() => {
                    setPage(data.page + 1);
                    setConfirmation(undefined);
                  }}
                >
                  Next email page
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
