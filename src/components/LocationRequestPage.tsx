import { LocationRequestForm } from "./LocationRequestForm";

interface LocationRequestPageProps {
  onNavigate: (path: string) => void;
}

export function LocationRequestPage({ onNavigate }: LocationRequestPageProps) {
  return (
    <main className="narrow-page">
      <button className="text-button back-button" type="button" onClick={() => onNavigate("/")}>
        ← Back to booking
      </button>
      <div className="eyebrow">Expand the route map</div>
      <h1>Request a location</h1>
      <p>
        Tell the owner where you need to go. If approved, it will appear in the next booking flow.
      </p>
      <section className="request-panel standalone-request">
        <LocationRequestForm />
      </section>
    </main>
  );
}
