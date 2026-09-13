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
            <span>Asa Bolt · Eastern Nigeria</span>
          </div>

          <div className="coming-message">
            <p className="coming-eyebrow">Eastern Nigeria</p>
            <h1 id="coming-title">
              Your city.
              <br />
              <em>Your ride.</em>
            </h1>
            <p className="coming-copy">
              We are getting the booking experience ready for simpler trips across Eastern Nigeria.
              For a ride today, message us directly on WhatsApp.
            </p>
            <a href={whatsappUrl} className="whatsapp-link" target="_blank" rel="noreferrer">
              Book a ride on WhatsApp <span aria-hidden="true">↗</span>
            </a>
          </div>

          <p className="coming-footnote">Street-smart rides, on your time.</p>
        </section>

        <aside className="coming-visual" aria-label="Asa Bolt Eastern Nigeria ride service preview">
          <div className="service-preview">
            <div className="service-preview-header">
              <span>Ride service preview</span>
              <span className="service-status">Opening soon</span>
            </div>
            <div className="route-map" aria-hidden="true">
              <span className="route-line route-line-short" />
              <span className="route-line route-line-long" />
              <span className="route-point route-point-start" />
              <span className="route-point route-point-end" />
              <span className="route-label route-label-start">Pickup</span>
              <span className="route-label route-label-end">Aba Road</span>
            </div>
            <div className="route-details">
              <div>
                <span>From</span>
                <strong>Where your day starts</strong>
              </div>
              <span className="route-arrow" aria-hidden="true">
                →
              </span>
              <div>
                <span>To</span>
                <strong>Where you need to be</strong>
              </div>
            </div>
            <div className="service-card">
              <span className="service-card-icon" aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>Everyday rides, made local</strong>
                <span>Schedule a pickup that fits your day.</span>
              </div>
            </div>
          </div>
          <div className="coming-visual-caption">
            <span>01 / EASTERN NIGERIA</span>
            <p>Move with local confidence.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
