"use client";

import type { Forecast } from "@/lib/weather/types";
import { SourceErrorRow, type SourceState } from "../weather-support";
import { TimeChart } from "./time-chart";

function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
  });
}

type SoilWaterPanelProps = {
  forecast: SourceState<Forecast>;
  onRetry: () => void;
};

export function SoilWaterPanel({ forecast, onRetry }: SoilWaterPanelProps) {
  if (forecast.status === "loading") {
    return <span aria-label="Loading charts" className="skeleton chart-skeleton" role="status" />;
  }
  if (forecast.status === "error") {
    return <SourceErrorRow message={forecast.error} onRetry={onRetry} sourceLabel="Open-Meteo forecast" />;
  }

  const days = forecast.data?.days ?? [];
  const labels = days.map((day) => dayLabel(day.date));

  return (
    <>
      <TimeChart
        decimals={1}
        series={[
          {
            id: "soil-moisture",
            label: "Soil moisture",
            color: "var(--chart-rain)",
            type: "line",
            points: days.map((day, index) => ({
              label: labels[index],
              value: day.soilMoisture === null ? null : day.soilMoisture * 100,
            })),
          },
        ]}
        title="Soil moisture — 7-day forecast (3–9 cm)"
        unit="vol %"
      />

      <TimeChart
        decimals={1}
        series={[
          {
            id: "soil-temp",
            label: "Soil temperature",
            color: "var(--chart-temp)",
            type: "line",
            points: days.map((day, index) => ({ label: labels[index], value: day.soilTempC })),
          },
        ]}
        title="Soil temperature — 7-day forecast (6 cm)"
        unit="°C"
      />

      <TimeChart
        decimals={1}
        series={[
          {
            id: "et0",
            label: "Reference evapotranspiration",
            color: "var(--chart-et0)",
            type: "bar",
            points: days.map((day, index) => ({ label: labels[index], value: day.et0Mm })),
          },
        ]}
        title="Evapotranspiration (ET0) — 7-day forecast"
        unit="mm"
      />
    </>
  );
}
