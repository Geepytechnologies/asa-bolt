import { type ReactElement } from "react";

const whatsappUrl = "https://wa.me/2348105440033";

export function App(): ReactElement {
  return (
    <main className="coming-page">
      <div className="coming-grid">
        <section className="coming-copy-panel" aria-labelledby="coming-title">
          <div className="coming-brand">
            <span className="coming-brand-mark" aria-hidden="true">
              A
            </span>
            <span>Asa Express · Umuahia</span>
          </div>

          <div className="coming-message">
            <p className="coming-eyebrow">Local delivery, in motion</p>
            <h1 id="coming-title">
              Website <em>coming soon.</em>
            </h1>
            <p className="coming-copy">
              We are polishing the production site. For updates, bookings, and delivery questions,
              reach us directly on WhatsApp.
            </p>
            <a href={whatsappUrl} className="whatsapp-link" target="_blank" rel="noreferrer">
              Chat on WhatsApp <span aria-hidden="true">↗</span>
            </a>
          </div>

          <p className="coming-footnote">Fast, thoughtful delivery is on its way.</p>
        </section>

        <aside className="coming-visual" aria-label="Asa Express brand">
          <div className="coming-image-frame">
            <img
              src="/assets/asa-express-logo.png"
              alt="Asa Express logo with a stylized winged delivery truck"
            />
          </div>
          <div className="coming-visual-caption">
            <span>01</span>
            <p>Asa Chukwu Express</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
