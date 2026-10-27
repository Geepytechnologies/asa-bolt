import { useCallback, useEffect, useState } from "react";
import type {
  FarePreview,
  FareRule,
  PricingArea,
  PricingOverview,
  ServiceRoute,
} from "../../shared/contracts";
import { apiFetch } from "../api";
import { formatNaira } from "../format";
import { Message } from "./Message";

type Draft = Record<string, unknown>;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const failureText = (error: unknown) =>
  error instanceof Error ? error.message : "The change could not be saved. Try again.";

function usePreview(token: string, draft: Draft | null) {
  const key = draft ? JSON.stringify(draft) : "";
  const [result, setResult] = useState<{ key: string; fare?: FarePreview; error?: string }>();
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiFetch<FarePreview>("/owner/pricing/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.parse(key),
        signal: controller.signal,
      })
        .then((fare) => setResult({ key, fare }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setResult({ key, error: failureText(error) });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, token]);
  return {
    fare: result?.key === key ? result.fare : undefined,
    error: result?.key === key ? result.error : undefined,
    pending: Boolean(key && result?.key !== key),
  };
}

function Preview({ value }: { value: ReturnType<typeof usePreview> }) {
  return (
    <div className="pricing-preview" aria-live="polite">
      <span className="eyebrow">Server fare preview</span>
      {value.pending ? (
        <p>Calculating…</p>
      ) : value.error ? (
        <p>{value.error}</p>
      ) : value.fare ? (
        <>
          <strong className="fare-preview-amount">{formatNaira(value.fare.amountKobo)}</strong>
          <p>
            {value.fare.pricing?.method === "fixed"
              ? "Fixed price"
              : `${value.fare.pricing?.distanceKm} km × ₦${value.fare.pricing?.ratePerKm} per km`}
          </p>
          {value.fare.pricing?.rateSource === "area" && (
            <p>
              Area rate
              {value.fare.pricing.pricingAreaName ? ` · ${value.fare.pricing.pricingAreaName}` : ""}
            </p>
          )}
          {value.fare.pricing?.rateSource === "default" && (
            <p>
              Default rate
              {value.fare.pricing.pricingAreaName
                ? ` · ${value.fare.pricing.pricingAreaName} has no area rate`
                : ""}
            </p>
          )}
          <p className="muted">
            Before rounding: ₦{value.fare.pricing?.unroundedNaira}. Final fare rounds up to a
            multiple of ₦50.
          </p>
        </>
      ) : (
        <p>Enter pricing details to see the fare before saving.</p>
      )}
    </div>
  );
}

export function PricingPanel({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [data, setData] = useState<PricingOverview>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState("");
  useEffect(() => {
    if (selection) document.getElementById("route-editor")?.scrollIntoView({ block: "start" });
  }, [selection]);
  const load = useCallback(async () => {
    const overview = await apiFetch<PricingOverview>("/owner/pricing", {
      headers: { Authorization: `Bearer ${token}` },
    });
    setData(overview);
  }, [token]);
  useEffect(() => {
    let active = true;
    apiFetch<PricingOverview>("/owner/pricing", { headers: { Authorization: `Bearer ${token}` } })
      .then((overview) => {
        if (active) setData(overview);
      })
      .catch((error: unknown) => {
        if (active) setError(failureText(error));
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function saved(message: string, route?: ServiceRoute) {
    setNotice(message);
    setError("");
    await load();
    if (route) setSelection(route.id);
    onSaved();
  }
  if (!data)
    return (
      <section className="owner-content">
        {error ? (
          <Message tone="error">{error}</Message>
        ) : (
          <p>Loading pricing and research routes…</p>
        )}
      </section>
    );
  const search = query.trim().toLowerCase();
  const areaNames = new Map(data.areas.map((area) => [area.id, area.name]));
  const matches = data.routes.filter(
    (route) =>
      `${route.originName} ${route.destinationName} ${areaNames.get(route.pricingAreaId ?? "") ?? ""}`
        .toLowerCase()
        .includes(search) &&
      (filter === "all" || route.published === (filter === "published")),
  );
  const pageCount = Math.max(1, Math.ceil(matches.length / 20));
  const currentPage = Math.min(page, pageCount - 1);
  const route = data.routes.find((item) => item.id === selection);
  return (
    <section className="owner-content pricing-content">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Pricing & locations</div>
          <h2>Pricing & routes</h2>
        </div>
        <span className="count-badge">
          {data.routes.filter((item) => item.published).length} published
        </span>
      </div>
      {error && <Message tone="error">{error}</Message>}
      {notice && <Message tone="success">{notice}</Message>}
      <p>
        {data.research.locationCount} research locations and {data.research.routePairCount} pairs
        imported as {data.research.directionalRouteCount} separate directions. Collected{" "}
        {data.research.collectionDate}. New research routes start as drafts.
      </p>
      <p className="muted">
        The workbook’s School Road → Umudike reference is ₦10,000 ÷ 9.8 km (suggested rate ₦
        {data.research.suggestedRatePerKm}/km). Review and enter your own rate below.
      </p>
      <details className="research-details">
        <summary>Research source details</summary>
        <p>{data.research.workbook}</p>
        <p>
          SHA-256: <code>{data.research.sha256}</code>
        </p>
        <p>
          Initial distances are reversible estimates. Editing one direction leaves the other
          direction unchanged.
        </p>
      </details>
      <DefaultRate
        key={data.settings.defaultRatePerKm ?? "unset"}
        token={token}
        initial={data.settings.defaultRatePerKm ?? ""}
        onSaved={() =>
          saved(
            "Default rate saved. Routes without an area rate use it; existing requests keep their saved fare.",
          )
        }
      />
      <PricingAreas token={token} data={data} onSaved={saved} />
      <div className="section-heading">
        <h3>Route catalogue</h3>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setSelection("new")}
        >
          Add route
        </button>
      </div>
      <div className="pricing-filters">
        <label>
          Search routes
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Pickup, destination or pricing area"
          />
        </label>
        <label>
          Show
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All routes</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
        </label>
      </div>
      <div className="route-list">
        {matches.slice(currentPage * 20, (currentPage + 1) * 20).map((item) => (
          <button
            type="button"
            key={item.id}
            className={`route-choice ${item.id === selection ? "selected" : ""}`}
            aria-pressed={item.id === selection}
            onClick={() => setSelection(item.id)}
          >
            <strong>
              {item.originName} → {item.destinationName}
            </strong>
            <span>
              {item.distanceKm ? `${item.distanceKm} km` : "Distance needed"} ·{" "}
              {item.published ? "Published" : "Draft"}
            </span>
            <span>
              Pricing area: {areaNames.get(item.pricingAreaId ?? "") ?? "None · default rate"}
            </span>
            <span className="text-link">Review & edit →</span>
          </button>
        ))}
        {matches.length === 0 && <Message tone="info">No routes match your search.</Message>}
      </div>
      <div className="action-row pagination">
        <button
          type="button"
          className="button button-secondary"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous
        </button>
        <span>
          {matches.length} routes · Page {currentPage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="button button-secondary"
          disabled={currentPage + 1 >= pageCount}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </button>
      </div>
      {(route || selection === "new") && (
        <RouteEditor
          key={JSON.stringify([route ?? "new", data.settings, data.areas, data.fares])}
          token={token}
          data={data}
          route={route}
          onSaved={saved}
        />
      )}
    </section>
  );
}

function DefaultRate({
  token,
  initial,
  onSaved,
}: {
  token: string;
  initial: string;
  onSaved: () => Promise<void>;
}) {
  const [rate, setRate] = useState(initial);
  const [sampleDistance, setSampleDistance] = useState("8.12");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = usePreview(
    token,
    rate && sampleDistance
      ? { mode: "distance", date: today(), distanceKm: sampleDistance, defaultRatePerKm: rate }
      : null,
  );
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/owner/pricing/settings", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: { defaultRatePerKm: rate || null },
      });
      await onSaved();
    } catch (error) {
      setError(failureText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pricing-card">
      <h3>Default rate per kilometre</h3>
      <p>
        Active fixed prices take priority, then the route’s area rate. Routes without an area rate
        use distance × this default rate. Clearing it makes routes without a fixed price or area
        rate unavailable.
      </p>
      {error && <Message tone="error">{error}</Message>}
      <form className="stack-form" onSubmit={save}>
        <fieldset disabled={busy} className="plain-fieldset">
          <div className="form-grid">
            <label>
              Default rate (₦/km)
              <input
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                placeholder="Not configured"
              />
            </label>
            <label>
              Example distance (km)
              <input
                inputMode="decimal"
                value={sampleDistance}
                onChange={(event) => setSampleDistance(event.target.value)}
              />
            </label>
          </div>
          <Preview value={preview} />
          <button
            type="submit"
            className="button button-primary"
            disabled={Boolean(rate) && !preview.fare}
          >
            {busy ? "Saving…" : rate ? "Save default rate" : "Clear default rate"}
          </button>
        </fieldset>
      </form>
    </div>
  );
}

function PricingAreas({
  token,
  data,
  onSaved,
}: {
  token: string;
  data: PricingOverview;
  onSaved: (message: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState("new");
  const area = data.areas.find((item) => item.id === selected);
  return (
    <section className="pricing-card" aria-label="Pricing areas">
      <h3>Pricing areas</h3>
      <p>
        Assign one area to each route. If its rate is blank, the default rate applies. Fixed route
        prices always take priority.
      </p>
      <label>
        Choose an area to edit
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="new">Add a pricing area</option>
          {data.areas.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.ratePerKm ? `₦${item.ratePerKm}/km` : "Default rate"}
            </option>
          ))}
        </select>
      </label>
      {!data.areas.length && (
        <p className="muted">
          No pricing areas yet. Existing routes continue to use fixed or default prices.
        </p>
      )}
      <AreaEditor
        key={JSON.stringify([area ?? "new", data.settings])}
        token={token}
        area={area}
        defaultRate={data.settings.defaultRatePerKm}
        onSaved={async (result) => {
          await onSaved(
            "Pricing area saved. New quotes use the applicable rate; existing requests keep their saved fare.",
          );
          setSelected(result.id);
        }}
      />
    </section>
  );
}

function AreaEditor({
  token,
  area,
  defaultRate,
  onSaved,
}: {
  token: string;
  area?: PricingArea;
  defaultRate: string | null;
  onSaved: (area: PricingArea) => Promise<void>;
}) {
  const [name, setName] = useState(area?.name ?? "");
  const [rate, setRate] = useState(area?.ratePerKm ?? "");
  const [distance, setDistance] = useState("8.12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = usePreview(
    token,
    distance
      ? {
          mode: "distance",
          date: today(),
          distanceKm: distance,
          pricingAreaId: area?.id ?? null,
          areaRatePerKm: rate || null,
          defaultRatePerKm: defaultRate,
        }
      : null,
  );
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<PricingArea>(`/owner/pricing/areas/${area?.id ?? "new"}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: { name, ratePerKm: rate || null },
      });
      await onSaved(result);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack-form" onSubmit={save}>
      <h4>{area ? "Edit pricing area" : "Add pricing area"}</h4>
      {error && <Message tone="error">{error}</Message>}
      <fieldset className="plain-fieldset" disabled={busy}>
        <div className="form-grid">
          <label>
            Area name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            Area rate (₦/km)
            <input
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              placeholder="Blank uses the default rate"
            />
          </label>
          <label>
            Area example distance (km)
            <input
              inputMode="decimal"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Leave the area rate blank to use the default rate
          {defaultRate ? ` of ₦${defaultRate}/km` : " (currently unset)"}. Rates keep their decimal
          precision; only the final fare rounds up to ₦50.
        </p>
        <Preview value={preview} />
        <button
          type="submit"
          className="button button-primary"
          disabled={!name.trim() || (Boolean(rate) && (!preview.fare || preview.pending))}
        >
          {busy ? "Saving…" : "Save pricing area"}
        </button>
      </fieldset>
    </form>
  );
}

function RouteEditor({
  token,
  data,
  route,
  onSaved,
}: {
  token: string;
  data: PricingOverview;
  route?: ServiceRoute;
  onSaved: (message: string, route?: ServiceRoute) => Promise<void>;
}) {
  const [originId, setOriginId] = useState(route?.originId ?? "");
  const [destinationId, setDestinationId] = useState(route?.destinationId ?? "");
  const [distance, setDistance] = useState(route?.distanceKm ?? "");
  const [note, setNote] = useState(route?.distanceNote ?? "");
  const [published, setPublished] = useState(route?.published ?? false);
  const [pricingAreaId, setPricingAreaId] = useState(route?.pricingAreaId ?? "");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingFare, setEditingFare] = useState<FareRule>();
  const preview = usePreview(
    token,
    originId && destinationId
      ? {
          originId,
          destinationId,
          date,
          distanceKm: distance || null,
          defaultRatePerKm: data.settings.defaultRatePerKm,
          pricingAreaId: pricingAreaId || null,
          rules: data.fares.filter(
            (fare) => fare.originId === originId && fare.destinationId === destinationId,
          ),
        }
      : null,
  );
  const fares = data.fares.filter(
    (fare) => fare.originId === originId && fare.destinationId === destinationId,
  );
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<ServiceRoute>(`/owner/routes/${route?.id ?? "new"}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          originId,
          destinationId,
          distanceKm: distance || null,
          distanceNote: note,
          published,
          pricingAreaId: pricingAreaId || null,
        },
      });
      await onSaved("Route saved for this direction only.", result);
    } catch (error) {
      setError(failureText(error));
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(fare: FareRule) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/owner/fare-rules/${fare.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: { ...fare, active: false },
      });
      setEditingFare(undefined);
      await onSaved(
        "Fixed price deactivated. The next eligible fixed price, area rate or default rate now applies.",
      );
    } catch (error) {
      setError(failureText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div id="route-editor" className="pricing-card route-editor">
      <h3>{route ? `${route.originName} → ${route.destinationName}` : "Add a direction"}</h3>
      {error && <Message tone="error">{error}</Message>}
      {route?.sourceUrl && (
        <div className="research-note">
          <a href={route.sourceUrl} target="_blank" rel="noreferrer">
            Open research route in Google Maps ↗
          </a>
          <p>
            Research distance: {route.researchDistanceKm} km · {route.sourceLabel} · Collected{" "}
            {route.collectedAt}
          </p>
          <p className="muted">
            Workbook Routes row {route.sourceRow}: {route.sourcePairKey}. Reverse directions
            initially share this distance and source.
          </p>
        </div>
      )}
      <form className="stack-form" onSubmit={save}>
        <fieldset disabled={busy} className="plain-fieldset">
          <div className="form-grid">
            <label>
              Route pickup
              <select
                value={originId}
                disabled={Boolean(route)}
                onChange={(event) => setOriginId(event.target.value)}
                required
              >
                <option value="">Choose pickup</option>
                {data.locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Route destination
              <select
                value={destinationId}
                disabled={Boolean(route)}
                onChange={(event) => setDestinationId(event.target.value)}
                required
              >
                <option value="">Choose destination</option>
                {data.locations
                  .filter((item) => item.id !== originId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Pricing area
              <select
                value={pricingAreaId}
                onChange={(event) => setPricingAreaId(event.target.value)}
              >
                <option value="">No area · use default rate</option>
                {data.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name} · {area.ratePerKm ? `₦${area.ratePerKm}/km` : "Default rate"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Distance (km)
              <input
                inputMode="decimal"
                value={distance}
                onChange={(event) => setDistance(event.target.value)}
                placeholder="Required for distance pricing"
              />
            </label>
            <label>
              Preview pickup date
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
          </div>
          <label>
            Distance correction note
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Optional reason for changing the research distance"
            />
          </label>
          <Preview value={preview} />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={published}
              onChange={(event) => setPublished(event.target.checked)}
            />
            Publish this direction for customers
          </label>
          <p className="muted">
            Publishing also publishes both locations. A usable price is required before publication.
            Hiding this direction leaves other routes available.
          </p>
          <button
            type="submit"
            className="button button-primary"
            disabled={
              !originId || !destinationId || (published && !preview.fare) || preview.pending
            }
          >
            {busy ? "Saving…" : "Save route"}
          </button>
        </fieldset>
      </form>
      {route ? (
        <>
          <h3>Fixed prices for this direction</h3>
          <p>
            The latest active price effective on the pickup date takes priority over area and
            default rates. For a new price change, add a new rule; deactivate a rule to stop using
            it.
          </p>
          <div className="data-list">
            {fares.length ? (
              fares.map((fare) => (
                <div key={fare.id}>
                  <strong>
                    {formatNaira(fare.roundedAmountKobo ?? fare.amountKobo)} final · entered ₦
                    {fare.amountKobo / 100}
                  </strong>
                  <span>
                    From {fare.effectiveFrom} · {fare.active ? "Active" : "Inactive"}
                  </span>
                  <span className="action-row">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setEditingFare(fare)}
                    >
                      Edit price
                    </button>
                    {fare.active && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void deactivate(fare)}
                      >
                        Deactivate
                      </button>
                    )}
                  </span>
                </div>
              ))
            ) : (
              <p className="muted">
                No fixed prices. The area rate applies when set, otherwise the default rate.
              </p>
            )}
          </div>
          <FixedPriceEditor
            key={editingFare ? JSON.stringify(editingFare) : "new"}
            token={token}
            route={route}
            fare={editingFare}
            onCancel={() => setEditingFare(undefined)}
            onSaved={async () => {
              setEditingFare(undefined);
              await onSaved("Fixed price saved. Existing requests keep their original fare.");
            }}
          />
        </>
      ) : (
        <p className="muted">Save this route as a draft first, then add its fixed price.</p>
      )}
    </div>
  );
}

function FixedPriceEditor({
  token,
  route,
  fare,
  onCancel,
  onSaved,
}: {
  token: string;
  route: ServiceRoute;
  fare?: FareRule;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(fare ? String(fare.amountKobo / 100) : "");
  const [date, setDate] = useState(fare?.effectiveFrom ?? today());
  const [active, setActive] = useState(fare?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = usePreview(
    token,
    amount && date
      ? {
          originId: route.originId,
          destinationId: route.destinationId,
          date,
          mode: "fixed",
          fixedAmountNaira: amount,
        }
      : null,
  );
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/owner/fare-rules/${fare?.id ?? "new"}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          originId: route.originId,
          destinationId: route.destinationId,
          amountNaira: amount,
          effectiveFrom: date,
          active,
        },
      });
      await onSaved();
      if (!fare) {
        setAmount("");
        setDate(today());
      }
    } catch (error) {
      setError(failureText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack-form fixed-price-form" onSubmit={save}>
      <h4>{fare ? "Edit fixed price" : "Add fixed price"}</h4>
      {error && <Message tone="error">{error}</Message>}
      <fieldset disabled={busy} className="plain-fieldset">
        <div className="form-grid">
          <label>
            Fixed price (₦)
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label>
            Effective from
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active rule
        </label>
        <Preview value={preview} />
        <div className="action-row">
          <button type="submit" className="button button-primary" disabled={!preview.fare}>
            {busy ? "Saving…" : "Save fixed price"}
          </button>
          {fare && (
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Add a new price instead
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
