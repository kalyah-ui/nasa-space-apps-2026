"use client";

import type { Forecast } from "@/lib/weather/types";
import { formatNumber, SourceErrorRow, type SourceState } from "../weather-support";
import { TimeChart } from "./time-chart";

/** Short text for WMO weather interpretation codes. */
function weatherText(code: number | null): string {
  if (code === null) {
    return "—";
  }
  if (code === 0) {
    return "Clear";
  }
  if (code <= 2) {
    return "Partly cloudy";
  }
  if (code === 3) {
    return "Overcast";
  }
  if (code === 45 || code === 48) {
    return "Fog";
  }
  if (code <= 57) {
    return "Drizzle";
  }
  if (code <= 67) {
    return "Rain";
  }
  if (code <= 77) {
    return "Snow";
  }
  if (code <= 82) {
    return "Showers";
  }
  if (code <= 86) {
    return "Snow showers";
  }
  return "Thunder";
}

function weekday(isoDate: string): string {
  return new Date(`${isoDate}T00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

type ForecastPanelProps = {
  forecast: SourceState<Forecast>;
  onRetry: () => void;
};

export function ForecastPanel({ forecast, onRetry }: ForecastPanelProps) {
  if (forecast.status === "loading") {
    return <span aria-label="Loading forecast" className="skeleton chart-skeleton" role="status" />;
  }
  if (forecast.status === "error") {
    return <SourceErrorRow message={forecast.error} onRetry={onRetry} sourceLabel="Open-Meteo forecast" />;
  }

  const days = forecast.data?.days ?? [];

  return (
    <>
      <div className="forecast-strip">
        {days.map((day) => (
          <div className="forecast-day" key={day.date}>
            <span className="forecast-day-name">{weekday(day.date)}</span>
            <span className="forecast-day-sky">{weatherText(day.weatherCode)}</span>
            <span className="forecast-day-temps">
              <strong>{day.tMaxC === null ? "—" : `${formatNumber(day.tMaxC)}°`}</strong>
              <span>{day.tMinC === null ? "—" : `${formatNumber(day.tMinC)}°`}</span>
            </span>
            <span className="forecast-day-rain">
              {day.rainMm === null ? "—" : `${formatNumber(day.rainMm, 1)} mm`}
            </span>
          </div>
        ))}
      </div>

      <TimeChart
        decimals={1}
        series={[
          {
            id: "forecast-rain",
            label: "Precipitation",
            color: "var(--chart-rain)",
            type: "bar",
            points: days.map((day) => ({
              label: weekday(day.date),
              value: day.rainMm,
            })),
          },
        ]}
        title="Precipitation — next 7 days"
        unit="mm"
      />

      <p className="listing-detail-placeholder">
        Timezone: {forecast.data?.timezone ?? "—"}. Daily highs, lows, and precipitation from
        Open-Meteo; soil detail lives in the Soil and water tab.
      </p>
    </>
  );
}
