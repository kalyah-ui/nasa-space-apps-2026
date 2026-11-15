"use client";

import { SourceErrorRow, formatNumber, useWeatherData } from "@/components/discovery/weather-support";
import { EstimateBadge } from "@/components/ui/estimate-badge";
import { KpiTile } from "@/components/ui/kpi-tile";
import { demoListings } from "@/components/discovery/listings/demo-listings";
import {
  averageTemperature,
  daysToNextFrost,
  estimateFormulas,
  rainfallTotal,
} from "@/lib/weather/derived";
import { weatherProvider } from "@/lib/weather/live-provider";
import type { DailyHistory, Forecast } from "@/lib/weather/types";

const demoField = demoListings.find((listing) => listing.id === "demo-field-01");

/**
 * Live KPI strip for the landing page: current conditions at the demo field,
 * from the same cached lib/weather provider the Discovery panel uses.
 */
export function FieldSnapshot() {
  // The hooks below have stable inputs, so this early return cannot change
  // between renders; it only guards against the demo listing being removed.
  if (!demoField) {
    return null;
  }

  return <FieldSnapshotInner latitude={demoField.latitude} longitude={demoField.longitude} />;
}

function FieldSnapshotInner({ latitude, longitude }: { latitude: number; longitude: number }) {
  // 60 days so the 30-reported-day aggregates have margin for gaps.
  const [history, retryHistory] = useWeatherData<DailyHistory>("landing-snapshot", () =>
    weatherProvider.getDailyHistory(latitude, longitude, 60),
  );
  const [forecast, retryForecast] = useWeatherData<Forecast>("landing-snapshot", () =>
    weatherProvider.getForecast(latitude, longitude),
  );

  const historyDays = history.data?.days ?? [];
  const rain30 = history.status === "ready" ? rainfallTotal(historyDays) : null;
  const temp30 = history.status === "ready" ? averageTemperature(historyDays) : null;
  const frostIn =
    forecast.status === "ready" && forecast.data ? daysToNextFrost(forecast.data.days) : undefined;
  const soilMoisture =
    forecast.status === "ready" ? (forecast.data?.days[0]?.soilMoisture ?? null) : null;

  return (
    <section aria-labelledby="landing-snapshot-title" className="landing-section">
      <div className="landing-section-header">
        <h2 className="landing-section-title" id="landing-snapshot-title">
          Right now at Demo Field 01
        </h2>
        <p className="landing-section-note">
          Ottawa Valley demo field <EstimateBadge kind="demo" /> · live NASA POWER and Open-Meteo
          data
        </p>
      </div>

      {history.status === "error" ? (
        <SourceErrorRow message={history.error} onRetry={retryHistory} sourceLabel="NASA POWER history" />
      ) : null}
      {forecast.status === "error" ? (
        <SourceErrorRow message={forecast.error} onRetry={retryForecast} sourceLabel="Open-Meteo forecast" />
      ) : null}

      <div className="kpi-grid">
        <KpiTile
          label="30-day rain"
          loading={history.status === "loading"}
          note="NASA POWER"
          unit="mm"
          value={rain30 !== null ? formatNumber(rain30) : null}
        />
        <KpiTile
          label="Avg temp (30d)"
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
    </section>
  );
}
