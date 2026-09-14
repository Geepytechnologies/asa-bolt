import { type ReactElement } from "react";
import logoUrl from "../assets/asa-express-mark.png";

const whatsappUrl = "https://wa.me/2348105440033";

export function App(): ReactElement {
  return (
    <main className="coming-page">
      <div className="coming-grid">
        <section className="coming-copy-panel" aria-labelledby="coming-title">
          <div className="coming-brand">
            <span className="coming-brand-mark">
              <img src={logoUrl} alt="Asa Ride logo" />
            </span>
            <span>Asa Ride · Eastern Nigeria</span>
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
            <p className="coming-scope">
              One ride service connecting Abia, Anambra, Ebonyi, Enugu, Imo, Delta, and beyond.
            </p>
            <ul className="service-list" aria-label="Asa Ride services">
              <li>Airport rides</li>
              <li>Hotel rides</li>
              <li>Event bookings</li>
              <li>Intercity trips</li>
              <li>Business rides</li>
              <li>School runs</li>
              <li>Errand rides</li>
            </ul>
            <a href={whatsappUrl} className="whatsapp-link" target="_blank" rel="noreferrer">
              Book a ride on WhatsApp <span aria-hidden="true">↗</span>
            </a>
          </div>

          <p className="coming-footnote">Reliability in every mile</p>
        </section>

        <aside className="coming-visual" aria-label="Asa Ride Eastern Nigeria ride service preview">
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
              <span className="route-vehicle">
                <svg viewBox="0 0 64 36" role="presentation">
                  <path d="M13 24.5h38.5a4 4 0 0 0 3.8-5.3l-2.7-7.8a4 4 0 0 0-3.8-2.7H24.4a4 4 0 0 0-3.5 2.1L16.7 18H13a3.5 3.5 0 0 0 0 7Z" />
                  <path d="m23 17 3.8-6h19.5l3.7 6H23Z" className="route-vehicle-window" />
                  <circle cx="21" cy="26" r="4.2" className="route-vehicle-wheel" />
                  <circle cx="48" cy="26" r="4.2" className="route-vehicle-wheel" />
                  <circle cx="21" cy="26" r="1.4" className="route-vehicle-hub" />
                  <circle cx="48" cy="26" r="1.4" className="route-vehicle-hub" />
                  <path d="M54.5 18.5h2.2" className="route-vehicle-light" />
                </svg>
              </span>
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
