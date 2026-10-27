import { useEffect, useRef, useState } from "react";
import { BRAND_CONFIG } from "../../shared/config";
import type {
  AvailableSchedule,
  BookingAccessResponse,
  FarePreview,
  OfferPreview,
  ServiceLocation,
  ServiceRoute,
} from "../../shared/contracts";
import { ApiError, createBooking, fetchFare, fetchCustomerSetup, previewPriceOffer } from "../api";
import { formatNaira } from "../format";
import { BookingSummary } from "./BookingSummary";
import { LocationRequestForm } from "./LocationRequestForm";
import { Message } from "./Message";

const emptyForm = {
  email: "",
  whatsappUpdates: false,
  whatsappNumber: "",
  originId: "",
  destinationId: "",
  pickupAt: "",
  pickupNote: "",
};

export function CustomerPage() {
  const [routes, setRoutes] = useState<Pick<ServiceRoute, "id" | "originId" | "destinationId">[]>(
    [],
  );
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [availability, setAvailability] = useState<AvailableSchedule[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [fare, setFare] = useState<FarePreview>();
  const [result, setResult] = useState<BookingAccessResponse>();
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [priceChoice, setPriceChoice] = useState<"accept" | "negotiate">("accept");
  const [offerAmount, setOfferAmount] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [offerResult, setOfferResult] = useState<{
    input: string;
    preview?: OfferPreview;
    error?: string;
  }>();
  const offer = offerResult?.input === offerAmount ? offerResult.preview : undefined;
  const offerError = offerResult?.input === offerAmount ? offerResult.error : "";
  const canSubmitPrice = priceChoice === "accept" || Boolean(offer);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fareError, setFareError] = useState("");
  const keyRef = useRef(crypto.randomUUID());
  const submittingRef = useRef(false);
  const pickupDate = form.pickupAt.slice(0, 10);
  const pickupTime = form.pickupAt.slice(11, 16);
  const selectedSchedule =
    availability.find(
      (item) =>
        item.date === pickupDate && pickupTime >= item.startTime && pickupTime < item.endTime,
    ) ?? availability.find((item) => item.date === pickupDate);
  const selectedLocations = locations.filter(
    (location) => location.id === form.originId || location.id === form.destinationId,
  );

  useEffect(() => {
    let active = true;
    fetchCustomerSetup()
      .then((setup) => {
        if (active) {
          setLocations(setup.locations);
          setRoutes(setup.routes);
          setAvailability(setup.availability);
        }
      })
      .catch(() => {
        if (active)
          setError("The booking service is temporarily unavailable. Please try again shortly.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (
      !form.originId ||
      !form.destinationId ||
      !pickupDate ||
      form.originId === form.destinationId
    )
      return;
    setQuoting(true);
    fetchFare(form.originId, form.destinationId, pickupDate)
      .then((quote) => {
        if (active) {
          setFare(quote);
          setFareError("");
        }
      })
      .catch(() => {
        if (active)
          setFareError(
            "This route is unavailable for the selected day. Choose another route or request a location below.",
          );
      })
      .finally(() => {
        if (active) setQuoting(false);
      });
    return () => {
      active = false;
    };
  }, [form.originId, form.destinationId, pickupDate]);

  useEffect(() => {
    if (priceChoice !== "negotiate" || !offerAmount.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      previewPriceOffer(offerAmount, controller.signal)
        .then((preview) => {
          if (!controller.signal.aborted) setOfferResult({ input: offerAmount, preview });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setOfferResult({
              input: offerAmount,
              error:
                error instanceof Error
                  ? error.message
                  : "We could not preview your offer. Try again.",
            });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [offerAmount, priceChoice]);

  function changeQuoteField(name: "originId" | "destinationId" | "pickupAt", value: string) {
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "originId" ? { destinationId: "" } : {}),
    }));
    setFare(undefined);
    setAgreed(false);
    setFareError("");
    setError("");
    setQuoting(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !fare || !agreed || !canSubmitPrice || !form.pickupAt) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const booking = await createBooking({
        ...form,
        email: form.email.trim(),
        pickupAt: new Date(`${form.pickupAt}:00+01:00`).toISOString(),
        quotedAmountKobo: fare.amountKobo,
        priceChoice,
        ...(priceChoice === "negotiate" && offer
          ? {
              proposedAmountNaira: offerAmount,
              proposedAmountKobo: offer.roundedAmountKobo,
              negotiationNote: offerNote,
            }
          : {}),
        idempotencyKey: keyRef.current,
      });
      setResult(booking);
      window.scrollTo(0, 0);
    } catch (failure) {
      if (failure instanceof ApiError && failure.fare) {
        setFare(failure.fare);
        setAgreed(false);
      } else if (failure instanceof ApiError && failure.offer) {
        setOfferResult({ input: offerAmount, preview: failure.offer });
        setAgreed(false);
      } else if (failure instanceof ApiError && [400, 409].includes(failure.status)) {
        setFare(undefined);
        setAgreed(false);
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "We could not save this request. Please try again.",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function handleNewBooking() {
    setResult(undefined);
    setForm(emptyForm);
    setPriceChoice("accept");
    setOfferAmount("");
    setOfferNote("");
    setOfferResult(undefined);
    setFare(undefined);
    setAgreed(false);
    setError("");
    keyRef.current = crypto.randomUUID();
  }

  if (result)
    return (
      <main className="narrow-page">
        <BookingSummary
          booking={result.booking}
          statusUrl={result.statusUrl}
          onNewBooking={handleNewBooking}
        />
      </main>
    );
  return (
    <main className="customer-shell">
      <section className="hero-panel">
        <div className="eyebrow">{BRAND_CONFIG.city}, made simpler</div>
        <h1>
          Move with
          <br />
          <em>local confidence.</em>
        </h1>
        <p>
          Request a local ride with your email. Review the fare, then wait for the admin to accept
          your request.
        </p>
        <div className="hero-stamp">
          AR <span>No signup needed</span>
        </div>
      </section>
      <section className="booking-panel" aria-labelledby="book-title">
        <div className="eyebrow">Request a ride</div>
        <h2 id="book-title">Where are you headed?</h2>
        {loading && <Message tone="info">Loading available routes and pickup times…</Message>}
        {error && <Message tone="error">{error}</Message>}
        {!loading && !error && routes.length === 0 && (
          <Message tone="info">
            No routes are published yet. You can request a location below.
          </Message>
        )}
        {!loading && routes.length > 0 && (
          <form className="stack-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                maxLength={254}
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                required
                disabled={submitting}
              />
            </label>
            <p className="form-help">
              We’ll email your receipt and the admin’s decision. No account or password needed.
              Unanswered requests are automatically rejected at pickup time.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.whatsappUpdates}
                disabled={submitting}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    whatsappUpdates: event.target.checked,
                    whatsappNumber: event.target.checked ? current.whatsappNumber : "",
                  }))
                }
              />
              Also send me WhatsApp updates for this ride (optional)
            </label>
            {form.whatsappUpdates && (
              <div>
                <label>
                  WhatsApp number
                  <input
                    type="tel"
                    aria-describedby="whatsapp-consent-help"
                    autoComplete="tel"
                    maxLength={20}
                    placeholder="+234…"
                    required
                    disabled={submitting}
                    value={form.whatsappNumber}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, whatsappNumber: event.target.value }))
                    }
                  />
                </label>
                <p className="form-help" id="whatsapp-consent-help">
                  I agree to receive booking updates and private ride links at this number. Email
                  remains the main channel. WhatsApp updates require the service to be connected.
                </p>
              </div>
            )}
            <label>
              Pickup location
              <select
                name="originId"
                value={form.originId}
                onChange={(event) => changeQuoteField("originId", event.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Choose a published location</option>
                {locations
                  .filter((location) => routes.some((route) => route.originId === location.id))
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Destination
              <select
                name="destinationId"
                value={form.destinationId}
                onChange={(event) => changeQuoteField("destinationId", event.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Choose a destination</option>
                {locations
                  .filter((location) =>
                    routes.some(
                      (route) =>
                        route.originId === form.originId && route.destinationId === location.id,
                    ),
                  )
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </label>
            {selectedLocations.length > 0 && (
              <div className="map-links">
                {selectedLocations.map(
                  (location) =>
                    location.mapsUrl && (
                      <a key={location.id} href={location.mapsUrl} target="_blank" rel="noreferrer">
                        Open {location.name} in Google Maps ↗
                      </a>
                    ),
                )}
              </div>
            )}
            <fieldset disabled={submitting}>
              <legend>Available pickup days</legend>
              {availability.length === 0 && (
                <Message tone="info">
                  No pickup times are available right now. Please check back later.
                </Message>
              )}
              <div className="schedule-grid">
                {availability.map((item) => (
                  <label
                    className={`schedule-option ${pickupDate === item.date && pickupTime >= item.startTime && pickupTime < item.endTime ? "selected" : ""}`}
                    key={`${item.date}-${item.startTime}`}
                  >
                    <input
                      type="radio"
                      name="schedule"
                      value={`${item.date}|${item.startTime}`}
                      checked={
                        pickupDate === item.date &&
                        pickupTime >= item.startTime &&
                        pickupTime < item.endTime
                      }
                      onChange={() =>
                        changeQuoteField("pickupAt", `${item.date}T${item.startTime}`)
                      }
                    />
                    <span>{item.label}</span>
                    <small>
                      {item.startTime} – {item.endTime}
                    </small>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Pickup time (Nigeria)
              <input
                type="time"
                name="pickupAt"
                value={form.pickupAt.slice(11, 16)}
                min={selectedSchedule?.startTime}
                max={
                  selectedSchedule
                    ? new Date(
                        new Date(`2000-01-01T${selectedSchedule.endTime}:00Z`).getTime() - 60_000,
                      )
                        .toISOString()
                        .slice(11, 16)
                    : undefined
                }
                disabled={!pickupDate || submitting}
                onChange={(event) => {
                  const time = event.currentTarget.value;
                  setForm((current) => ({ ...current, pickupAt: `${pickupDate}T${time}` }));
                }}
                required
              />
            </label>
            {quoting && <Message tone="info">Calculating your fare…</Message>}
            {fareError && <Message tone="error">{fareError}</Message>}
            {fare && (
              <div className="fare-preview">
                <span>Quoted fare</span>
                <strong>{formatNaira(fare.amountKobo)}</strong>
                <small>Your ride stays pending until the admin accepts.</small>
              </div>
            )}
            {fare && (
              <>
                <fieldset className="price-choice" disabled={submitting}>
                  <legend>Choose your price</legend>
                  <label className="price-choice-option">
                    <input
                      type="radio"
                      name="priceChoice"
                      value="accept"
                      checked={priceChoice === "accept"}
                      onChange={() => {
                        setPriceChoice("accept");
                        setAgreed(false);
                      }}
                    />
                    Accept price · {formatNaira(fare.amountKobo)}
                  </label>
                  <label className="price-choice-option">
                    <input
                      type="radio"
                      name="priceChoice"
                      value="negotiate"
                      checked={priceChoice === "negotiate"}
                      onChange={() => {
                        setPriceChoice("negotiate");
                        setAgreed(false);
                      }}
                    />
                    Negotiate price
                  </label>
                </fieldset>
                {priceChoice === "negotiate" && (
                  <div className="offer-form">
                    <p>
                      Make one offer for this request. The admin can accept or reject it. You can
                      make a new request after rejection.
                    </p>
                    <label>
                      Your offer (₦)
                      <input
                        inputMode="decimal"
                        value={offerAmount}
                        onChange={(event) => {
                          setOfferAmount(event.target.value);
                          setOfferResult(undefined);
                          setAgreed(false);
                        }}
                        disabled={submitting}
                        required
                        maxLength={32}
                        placeholder="For example, 812"
                      />
                    </label>
                    <div className="offer-preview" aria-live="polite">
                      {offer ? (
                        <>
                          <strong>Offer to send: {formatNaira(offer.roundedAmountKobo)}</strong>
                          <p>
                            ₦{offer.amountNaira} rounds up to {formatNaira(offer.roundedAmountKobo)}
                            . This will be your agreed fare if accepted.
                          </p>
                        </>
                      ) : offerError ? (
                        <p>{offerError}</p>
                      ) : (
                        <p>
                          {offerAmount.trim()
                            ? "Calculating your rounded offer…"
                            : "Enter an amount to preview your rounded offer."}
                        </p>
                      )}
                    </div>
                    <label>
                      Negotiation note <span className="muted">(optional)</span>
                      <textarea
                        rows={2}
                        maxLength={240}
                        value={offerNote}
                        onChange={(event) => setOfferNote(event.target.value)}
                        disabled={submitting}
                        placeholder="A short note for the admin"
                      />
                    </label>
                  </div>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={agreed}
                    disabled={submitting || !canSubmitPrice}
                    onChange={(event) => setAgreed(event.target.checked)}
                    required
                  />
                  <span>
                    {priceChoice === "accept"
                      ? `I agree to the quoted fare of ${formatNaira(fare.amountKobo)}.`
                      : offer
                        ? `Send my one offer of ${formatNaira(offer.roundedAmountKobo)} for admin approval.`
                        : "Review your rounded offer before sending."}
                  </span>
                </label>
              </>
            )}

            <label>
              Pickup note <span className="muted">(optional)</span>
              <textarea
                name="pickupNote"
                rows={2}
                maxLength={240}
                disabled={submitting}
                value={form.pickupNote}
                onChange={(event) =>
                  setForm((current) => ({ ...current, pickupNote: event.target.value }))
                }
                placeholder="A landmark or pickup detail"
              />
            </label>
            <button
              className="button button-primary button-wide"
              type="submit"
              disabled={!fare || !agreed || !canSubmitPrice || submitting}
            >
              {submitting
                ? "Sending request…"
                : priceChoice === "negotiate"
                  ? "Send offer & ride request"
                  : "Send ride request"}
            </button>
          </form>
        )}
      </section>
      <section className="trust-strip">
        <span>01 / No signup</span>
        <span>02 / Clear fares</span>
        <span>03 / Admin approval</span>
      </section>
      <section className="request-panel">
        <div>
          <div className="eyebrow">Can’t see your place?</div>
          <h2>Put it on the map.</h2>
          <p>
            Tell us the spot and a nearby landmark. Approved locations become available for future
            rides.
          </p>
        </div>
        <LocationRequestForm />
      </section>
      <a className="owner-link" href="/admin">
        Admin portal →
      </a>
    </main>
  );
}
