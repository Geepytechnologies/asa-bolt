import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND_CONFIG } from "../../shared/config";
import type {
  AvailableSchedule,
  BookingAccessResponse,
  FarePreview,
  ServiceLocation,
} from "../../shared/contracts";
import { buildAvailability, createBooking, fetchFare, fetchCustomerSetup } from "../api";
import { formatNaira } from "../format";
import { BookingSummary } from "./BookingSummary";
import { LocationRequestForm } from "./LocationRequestForm";
import { Message } from "./Message";

interface CustomerPageProps {
  onViewStatus: (token: string) => void;
}
interface FormState {
  customerName: string;
  phone: string;
  originId: string;
  destinationId: string;
  pickupAt: string;
  pickupNote: string;
}
const emptyForm: FormState = {
  customerName: "",
  phone: "",
  originId: "",
  destinationId: "",
  pickupAt: "",
  pickupNote: "",
};

export function CustomerPage({ onViewStatus }: CustomerPageProps) {
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [availability, setAvailability] = useState<AvailableSchedule[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [fare, setFare] = useState<FarePreview>();
  const [result, setResult] = useState<BookingAccessResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const keyRef = useRef(crypto.randomUUID());
  const selectedLocations = locations.filter(
    (location) => location.id === form.originId || location.id === form.destinationId,
  );
  useEffect(() => {
    void loadSetup(setLocations, setAvailability, setError, setLoading);
  }, []);
  const handleFieldChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const next = { ...form, [event.target.name]: event.target.value };
      setForm(next);
      setError("");
      if (event.target.name === "originId" || event.target.name === "destinationId")
        void updateFare(next.originId, next.destinationId, setFare);
    },
    [form],
  );
  const handleScheduleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const schedule = availability.find((item) => item.date === event.target.value);
      setForm((current) => ({
        ...current,
        pickupAt: schedule ? `${schedule.date}T${schedule.startTime}` : "",
      }));
    },
    [availability],
  );
  const handleTimeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({
      ...current,
      pickupAt: current.pickupAt.slice(0, 10)
        ? `${current.pickupAt.slice(0, 10)}T${event.target.value}`
        : "",
    }));
  }, []);
  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError("");
      if (!form.pickupAt) {
        setError("Choose an available pickup day and time first.");
        return;
      }
      try {
        setResult(await createBooking({ ...form, idempotencyKey: keyRef.current }));
      } catch {
        setError("We could not confirm this ride. Check the highlighted details and try again.");
      }
    },
    [form],
  );
  const handleNewBooking = useCallback(() => {
    setResult(undefined);
    setForm(emptyForm);
    setFare(undefined);
    keyRef.current = crypto.randomUUID();
  }, []);
  if (result)
    return (
      <BookingSummary
        booking={result.booking}
        statusUrl={result.statusUrl}
        onNewBooking={handleNewBooking}
      />
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
        <p>Reliable rides between the places that make your day work. No account. No guesswork.</p>
        <div className="hero-stamp">
          AB <span>Since today</span>
        </div>
      </section>
      <section className="booking-panel" aria-labelledby="book-title">
        <div className="eyebrow">Book a ride</div>
        <h2 id="book-title">Where are you headed?</h2>
        {loading && <Message tone="info">Loading published {BRAND_CONFIG.city} locations…</Message>}
        {error && <Message tone="error">{error}</Message>}
        {!loading && (
          <form className="stack-form" onSubmit={handleSubmit}>
            <label>
              Pickup location
              <select name="originId" value={form.originId} onChange={handleFieldChange} required>
                <option value="">Choose a published location</option>
                {locations.map((location) => (
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
                onChange={handleFieldChange}
                required
              >
                <option value="">Choose a destination</option>
                {locations.map((location) => (
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
            {fare && (
              <div className="fare-preview">
                <span>Current fare</span>
                <strong>{formatNaira(fare.amountKobo)}</strong>
                <small>Locked into this booking at confirmation</small>
              </div>
            )}
            <fieldset>
              <legend>Available schedules</legend>
              <div className="schedule-grid">
                {availability.map((item) => (
                  <label
                    className={`schedule-option ${form.pickupAt.startsWith(item.date) ? "selected" : ""}`}
                    key={item.date}
                  >
                    <input
                      type="radio"
                      name="schedule"
                      value={item.date}
                      checked={form.pickupAt.startsWith(item.date)}
                      onChange={handleScheduleChange}
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
              Pickup time
              <input
                name="pickupAt"
                type="time"
                value={form.pickupAt.slice(11, 16)}
                min="06:30"
                max="20:30"
                onChange={handleTimeChange}
                required
              />
            </label>
            <label>
              Your name
              <input
                name="customerName"
                value={form.customerName}
                onChange={handleFieldChange}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Phone number
              <input
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleFieldChange}
                placeholder="0801 234 5678"
                autoComplete="tel"
                required
              />
            </label>
            <label>
              Pickup note <span className="muted">(optional)</span>
              <textarea
                name="pickupNote"
                rows={2}
                value={form.pickupNote}
                onChange={handleFieldChange}
                placeholder="Landmark or extra detail for the owner"
              />
            </label>
            <button className="button button-primary button-wide" type="submit" disabled={!fare}>
              Confirm my ride
            </button>
          </form>
        )}
      </section>
      <section className="trust-strip">
        <span>01 / Local routes</span>
        <span>02 / Clear fares</span>
        <span>03 / Human dispatch</span>
      </section>
      <section className="request-panel">
        <div>
          <div className="eyebrow">Can’t see your place?</div>
          <h2>Put it on the map.</h2>
          <p>
            Tell us the spot and a nearby landmark. Approved requests become selectable locations.
          </p>
        </div>
        <LocationRequestForm />
      </section>
      <button className="owner-link" type="button" onClick={() => onViewStatus("owner")}>
        Owner dashboard →
      </button>
    </main>
  );
}

async function loadSetup(
  setLocations: (value: ServiceLocation[]) => void,
  setAvailability: (value: AvailableSchedule[]) => void,
  setError: (value: string) => void,
  setLoading: (value: boolean) => void,
): Promise<void> {
  try {
    const setup = await fetchCustomerSetup();
    setLocations(setup.locations);
    setAvailability(buildAvailability(setup.schedule, 8));
  } catch {
    setError("The booking service is not reachable. Start the local API and refresh.");
  } finally {
    setLoading(false);
  }
}

async function updateFare(
  originId: string,
  destinationId: string,
  setFare: (value: FarePreview | undefined) => void,
): Promise<void> {
  if (!originId || !destinationId || originId === destinationId) {
    setFare(undefined);
    return;
  }
  try {
    setFare(await fetchFare(originId, destinationId));
  } catch {
    setFare(undefined);
  }
}
