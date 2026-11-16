"use client";

import { SourceErrorRow, formatNumber, useWeatherData } from "@/components/discovery/weather-support";
import { KpiTile } from "@/components/ui/kpi-tile";
import {
  averageTemperature,
  daysToNextFrost,
  estimateFormulas,
  rainfallTotal,
} from "@/lib/weather/derived";
import { weatherProvider } from "@/lib/weather/live-provider";
import type { DailyHistory, Forecast } from "@/lib/weather/types";

const ottawaValleyCenter = { latitude: 45.3083, longitude: -76.2925 };

/**
 * The weather strip uses live regional data at the centre of the Ottawa Landsat scene.
 */
export function FieldSnapshot() {
  return (
    <FieldSnapshotInner
      latitude={ottawaValleyCenter.latitude}
      longitude={ottawaValleyCenter.longitude}
    />
  );
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
          Ottawa Valley Today
        </h2>
        <p className="landing-section-note">
          Live regional conditions near the demo fields — not parcel measurements
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
    </section>
  );
}
