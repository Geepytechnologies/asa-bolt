import { type ReactElement } from "react";

const whatsappUrl = "https://wa.me/2348105440033";

export function App(): ReactElement {
  return (
    <main className="coming-page">
      <section className="coming-card" aria-live="polite">
        <p className="coming-eyebrow">Asa Bolt</p>
        <h1>Website coming soon</h1>
        <p className="coming-copy">
          We are polishing things on the production site. Reach us on WhatsApp for updates and bookings.
        </p>
        <a href={whatsappUrl} className="whatsapp-link" target="_blank" rel="noreferrer">
          Chat on WhatsApp
        </a>
      </section>
    </main>
  );
}
