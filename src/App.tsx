import { lazy, Suspense, useEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { BRAND_CONFIG } from "../shared/config";
import logoUrl from "../assets/asa-express-mark.png";
import { BookingPage } from "./components/BookingPage";
import { LocationRequestPage } from "./components/LocationRequestPage";
import { StatusPage } from "./components/StatusPage";
import { MyRequestsPage } from "./components/MyRequestsPage";

const OwnerDashboard = lazy(() =>
  import("./components/OwnerDashboard").then((module) => ({ default: module.OwnerDashboard })),
);
const navigationEvent = "asa:navigate";

function subscribeToNavigation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(navigationEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(navigationEvent, onChange);
  };
}

function currentPath() {
  return window.location.pathname;
}

function navigate(path: string) {
  if (path === window.location.pathname + window.location.search + window.location.hash) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(navigationEvent));
}

function handleLinkClick(event: MouseEvent<HTMLDivElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href);
  if (url.origin !== window.location.origin || url.hash) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
}

type Route =
  | { page: "booking" | "admin" | "location" | "history" | "missing" }
  | { page: "status"; token: string };

function resolveRoute(path: string): Route {
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/") return { page: "booking" };
  if (normalized === "/admin" || normalized === "/owner") return { page: "admin" };
  if (normalized === "/request-location") return { page: "location" };
  if (normalized === "/my-requests") return { page: "history" };
  const match = normalized.match(/^\/status\/([^/]+)$/);
  if (match) {
    try {
      return { page: "status", token: decodeURIComponent(match[1]) };
    } catch {
      return { page: "missing" };
    }
  }
  return { page: "missing" };
}

const pageTitles = {
  booking: "Request a ride",
  history: "My requests",
  admin: "Admin portal",
  location: "Request a location",
  status: "Ride details",
  missing: "Page not found",
};

export function App() {
  const path = useSyncExternalStore(subscribeToNavigation, currentPath);
  const route = resolveRoute(path);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${pageTitles[resolveRoute(path).page]} · ${BRAND_CONFIG.name}`;
    contentRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [path]);

  return (
    <div className="app-shell" onClick={handleLinkClick}>
      <a className="skip-link" href="#page-content">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label={`${BRAND_CONFIG.name} home`}>
          <span className="brand-mark">
            <img src={logoUrl} alt="" />
          </span>
          <span>
            <strong>{BRAND_CONFIG.name}</strong>
            <small>Eastern Nigeria rides</small>
          </span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a href="/" aria-current={route.page === "booking" ? "page" : undefined}>
            Request a ride
          </a>
          <a href="/my-requests" aria-current={route.page === "history" ? "page" : undefined}>
            My requests
          </a>
          <a href="/request-location" aria-current={route.page === "location" ? "page" : undefined}>
            Request a location
          </a>
          <a href="/admin" aria-current={route.page === "admin" ? "page" : undefined}>
            Admin portal
          </a>
        </nav>
      </header>
      <div id="page-content" ref={contentRef} tabIndex={-1}>
        <Suspense
          fallback={
            <main className="narrow-page" aria-busy="true">
              <p role="status">Loading admin portal…</p>
            </main>
          }
        >
          {route.page === "booking" && <BookingPage />}
          {route.page === "admin" && <OwnerDashboard onNavigate={navigate} />}
          {route.page === "location" && <LocationRequestPage onNavigate={navigate} />}
          {route.page === "history" && <MyRequestsPage />}
          {route.page === "status" && (
            <StatusPage key={route.token} token={route.token} onNavigate={navigate} />
          )}
          {route.page === "missing" && (
            <main className="narrow-page">
              <div className="eyebrow">Page not found</div>
              <h1>Let’s get you back.</h1>
              <p>This page isn’t available. Check your private status link or return to booking.</p>
              <a className="button button-primary" href="/">
                Back to booking
              </a>
            </main>
          )}
        </Suspense>
      </div>
      <footer className="site-footer">
        <span>{BRAND_CONFIG.name} · Eastern Nigeria</span>
        <span>Reliability in every mile</span>
      </footer>
    </div>
  );
}
