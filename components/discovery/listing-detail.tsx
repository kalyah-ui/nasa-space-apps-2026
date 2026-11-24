"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EstimateBadge } from "@/components/ui/estimate-badge";
import { KpiTile } from "@/components/ui/kpi-tile";
import { DataCenterSignal } from "./data-center-signal";
import { NearbyWells } from "./nearby-wells";
import { ClimatePanel } from "./charts/climate-panel";
import { ForecastPanel } from "./charts/forecast-panel";
import { SoilWaterPanel } from "./charts/soil-water-panel";
import { formatNumber, SourceErrorRow, useWeatherData } from "./weather-support";
import {
  averageTemperature,
  daysToNextFrost,
  drynessIndex,
  estimateFormulas,
  rainfallTotal,
} from "@/lib/weather/derived";
import { weatherProvider } from "@/lib/weather/live-provider";
import {
  type ClimateNormals,
  type DailyHistory,
  type Forecast,
  SOURCE_ATTRIBUTION,
} from "@/lib/weather/types";
import type { DemoListing } from "./listings/demo-listings";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "climate", label: "Climate" },
  { id: "soil-water", label: "Soil and Water" },
  { id: "forecast", label: "Forecast" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function buildVerdict(args: {
  rain30: number | null;
  dryness: number | null;
  frostIn: number | null | undefined;
  soilMoisture: number | null;
}): string {
  const sentences: string[] = [];

  if (args.rain30 !== null) {
    const rainfall = `${formatNumber(args.rain30)} mm over the last 30 days`;
    if (args.dryness === null) {
      sentences.push(`Recorded rainfall: ${rainfall}.`);
    } else {
      const comparison = args.dryness < 0.4 ? "well below normal"
        : args.dryness < 0.75 ? "below normal"
          : args.dryness <= 1.3 ? "near normal"
            : args.dryness <= 2 ? "above normal" : "well above normal";
      sentences.push(`Rainfall is ${comparison}: ${rainfall}.`);
    }
  }

  if (args.frostIn !== undefined) {
    if (args.frostIn === null) {
      sentences.push("No frost-risk temperatures in the seven-day forecast.");
    } else {
      const timing = args.frostIn === 0 ? "today" : args.frostIn === 1 ? "tomorrow" : `in ${args.frostIn} days`;
      sentences.push(`Frost risk ${timing}: forecast lows may reach 2°C or below.`);
    }
  }

  if (args.soilMoisture !== null && args.soilMoisture < 0.15) {
    sentences.push(`Shallow soil moisture is low (${formatNumber(args.soilMoisture * 100)}% by volume).`);
  }

  return sentences.join(" ");
}

type ListingDetailProps = {
  listing: DemoListing;
  onClose: () => void;
};

export function ListingDetail({ listing, onClose }: ListingDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const tablistRef = useRef<HTMLDivElement>(null);

  // 365 days so the Climate tab can chart this year vs the normals;
  // the Overview KPIs read the most recent 30 and charts slice the last 90.
  const [history, retryHistory] = useWeatherData<DailyHistory>(listing.id, () =>
    weatherProvider.getDailyHistory(listing.latitude, listing.longitude, 365),
  );
  const [normals, retryNormals] = useWeatherData<ClimateNormals>(listing.id, () =>
    weatherProvider.getClimateNormals(listing.latitude, listing.longitude),
  );
  const [forecast, retryForecast] = useWeatherData<Forecast>(listing.id, () =>
    weatherProvider.getForecast(listing.latitude, listing.longitude),
  );

  // Reset to Overview when switching listings.
  useEffect(() => {
    setActiveTab("overview");
  }, [listing.id]);

  const onTablistKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(currentIndex + delta + TABS.length) % TABS.length];
    setActiveTab(next.id);
    tablistRef.current
      ?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)
      ?.focus();
  };

  const historyDays = history.data?.days ?? [];
  const rain30 = history.status === "ready" ? rainfallTotal(historyDays) : null;
  const temp30 = history.status === "ready" ? averageTemperature(historyDays) : null;
  const dryness =
    history.status === "ready" && normals.status === "ready" && normals.data
      ? drynessIndex(historyDays, normals.data)
      : null;
  const frostIn =
    forecast.status === "ready" && forecast.data ? daysToNextFrost(forecast.data.days) : undefined;
  const soilMoisture =
    forecast.status === "ready" ? (forecast.data?.days[0]?.soilMoisture ?? null) : null;

  const anyReady =
    history.status === "ready" || normals.status === "ready" || forecast.status === "ready";
  const verdict = anyReady ? buildVerdict({ rain30, dryness, frostIn, soilMoisture }) : "";
  const lastUpdated = [history.data?.fetchedAt, normals.data?.fetchedAt, forecast.data?.fetchedAt]
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .pop();

  return (
    <section aria-label={`${listing.name} details`} className="listing-detail" tabIndex={-1}>
      <header className="listing-detail-header">
        <div>
          <h2 className="listing-detail-name">
            {listing.name} <EstimateBadge kind="demo" />
          </h2>
          <p className="listing-detail-sub">
            {listing.acres.toLocaleString("en-US")} ac · {listing.latitude.toFixed(3)},{" "}
            {listing.longitude.toFixed(3)}
          </p>
        </div>
        <button aria-label="Close listing details" className="listing-detail-close" onClick={onClose} type="button">
          <X aria-hidden="true" size={16} strokeWidth={2} />
        </button>
      </header>

      <div
        aria-label="Listing data tabs"
        className="listing-detail-tabs"
        onKeyDown={onTablistKeyDown}
        ref={tablistRef}
        role="tablist"
      >
        {TABS.map((tab) => (
          <button
            aria-controls={`panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={`listing-detail-tab${activeTab === tab.id ? " is-active" : ""}`}
            id={`tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div aria-labelledby="tab-overview" className="listing-detail-panel" id="panel-overview" role="tabpanel">
          {history.status === "error" ? (
            <SourceErrorRow message={history.error} onRetry={retryHistory} sourceLabel="NASA POWER history" />
          ) : null}
          {normals.status === "error" ? (
            <SourceErrorRow message={normals.error} onRetry={retryNormals} sourceLabel="NASA POWER normals" />
          ) : null}
          {forecast.status === "error" ? (
            <SourceErrorRow message={forecast.error} onRetry={retryForecast} sourceLabel="Open-Meteo forecast" />
          ) : null}

          <div className="kpi-grid">
            <KpiTile
              label="30-day rainfall"
              loading={history.status === "loading"}
              note="NASA POWER"
              unit="mm"
              value={rain30 !== null ? formatNumber(rain30) : null}
            />
            <KpiTile
              label="Average temperature (30 days)"
              loading={history.status === "loading"}
              note="NASA POWER"
              unit="°C"
              value={temp30 !== null ? formatNumber(temp30, 1) : null}
            />
            <KpiTile
              label="Soil moisture"
              loading={forecast.status === "loading"}
              note="3–9 cm, Open-Meteo"
              unit="vol %"
              value={soilMoisture !== null ? formatNumber(soilMoisture * 100) : null}
            />
            <KpiTile
              estimateTitle={estimateFormulas.daysToNextFrost}
              label="Frost risk"
              loading={forecast.status === "loading"}
              note={frostIn === null ? "none in 7-day window" : "first day with Tmin ≤ 2°C"}
              unit={frostIn === null ? undefined : "days"}
              value={frostIn === undefined ? null : frostIn === null ? "7+" : `${frostIn}`}
            />
          </div>

          <NearbyWells listing={listing} />
          <DataCenterSignal listing={listing} />

          {verdict ? (
            <blockquote className="listing-verdict">
              {verdict}
              <footer className="listing-verdict-tag">
                Rule-based summary; no AI was used. <EstimateBadge />
              </footer>
            </blockquote>
          ) : null}

          <p className="listing-detail-price-row">
            Asking price: <span className="listing-detail-price">${listing.priceCad.toLocaleString("en-US")}</span>{" "}
            · {listing.description}
          </p>
        </div>
      ) : null}

      {activeTab === "climate" ? (
        <div aria-labelledby="tab-climate" className="listing-detail-panel" id="panel-climate" role="tabpanel">
          <ClimatePanel
            history={history}
            normals={normals}
            onRetryHistory={retryHistory}
            onRetryNormals={retryNormals}
          />
        </div>
      ) : null}

      {activeTab === "soil-water" ? (
        <div aria-labelledby="tab-soil-water" className="listing-detail-panel" id="panel-soil-water" role="tabpanel">
          <SoilWaterPanel forecast={forecast} onRetry={retryForecast} />
        </div>
      ) : null}

      {activeTab === "forecast" ? (
        <div aria-labelledby="tab-forecast" className="listing-detail-panel" id="panel-forecast" role="tabpanel">
          <ForecastPanel forecast={forecast} onRetry={retryForecast} />
        </div>
      ) : null}

      <footer className="listing-detail-attribution">
        Data: <a href={SOURCE_ATTRIBUTION["nasa-power"].url} rel="noreferrer" target="_blank">NASA POWER</a>
        {" · "}
        <a href={SOURCE_ATTRIBUTION["open-meteo"].url} rel="noreferrer" target="_blank">Open-Meteo</a>
        {lastUpdated
          ? ` · updated ${new Date(lastUpdated).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
      </footer>
    </section>
  );
}
