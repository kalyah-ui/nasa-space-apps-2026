"use client";

import { EstimateBadge } from "@/components/ui/estimate-badge";
import {
  drynessIndex,
  drynessLabel,
  estimateFormulas,
  frostRiskDays,
  growingDegreeDays,
} from "@/lib/weather/derived";
import type { ClimateNormals, DailyHistory } from "@/lib/weather/types";
import { formatNumber, SourceErrorRow, type SourceState } from "../weather-support";
import { TimeChart } from "./time-chart";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

type ClimatePanelProps = {
  history: SourceState<DailyHistory>;
  normals: SourceState<ClimateNormals>;
  onRetryHistory: () => void;
  onRetryNormals: () => void;
};

export function ClimatePanel({ history, normals, onRetryHistory, onRetryNormals }: ClimatePanelProps) {
  if (history.status === "loading") {
    return <span aria-label="Loading charts" className="skeleton chart-skeleton" role="status" />;
  }
  if (history.status === "error") {
    return (
      <SourceErrorRow message={history.error} onRetry={onRetryHistory} sourceLabel="NASA POWER history" />
    );
  }

  const days = history.data?.days ?? [];
  const last90 = days.slice(-90);
  const labels90 = last90.map((day) => shortDate(day.date));

  // "This year vs normal": monthly rain totals for the current calendar year
  // against the long-term normal for each month.
  const year = Number((days[days.length - 1]?.date ?? `${new Date().getFullYear()}`).slice(0, 4));
  const thisYearDays = days.filter((day) => day.date.startsWith(`${year}-`));
  const monthCount = thisYearDays.length > 0 ? Number(thisYearDays[thisYearDays.length - 1].date.slice(5, 7)) : 0;
  const monthlyActual: Array<number | null> = [];
  for (let month = 1; month <= monthCount; month += 1) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const reported = thisYearDays.filter((day) => day.date.startsWith(prefix) && day.rainMm !== null);
    monthlyActual.push(
      reported.length > 0 ? reported.reduce((sum, day) => sum + (day.rainMm ?? 0), 0) : null,
    );
  }

  const gdd = growingDegreeDays(last90);
  const frost = frostRiskDays(last90);
  const dryness =
    normals.status === "ready" && normals.data ? drynessIndex(days, normals.data) : null;

  return (
    <>
      <TimeChart
        decimals={1}
        series={[
          {
            id: "rain",
            label: "Rainfall",
            color: "var(--chart-rain)",
            type: "bar",
            points: last90.map((day, index) => ({ label: labels90[index], value: day.rainMm })),
          },
        ]}
        title="Rainfall — Last 90 Days"
        unit="mm"
      />

      <TimeChart
        decimals={1}
        series={[
          {
            id: "temp",
            label: "Mean temperature",
            color: "var(--chart-temp)",
            type: "line",
            points: last90.map((day, index) => ({ label: labels90[index], value: day.tMeanC })),
          },
        ]}
        title="Temperature — Last 90 Days"
        unit="°C"
      />

      {normals.status === "error" ? (
        <SourceErrorRow message={normals.error} onRetry={onRetryNormals} sourceLabel="NASA POWER normals" />
      ) : null}
      {normals.status === "ready" && normals.data && monthCount > 0 ? (
        <TimeChart
          decimals={0}
          series={[
            {
              id: "actual",
              label: `${year} (to date)`,
              color: "var(--chart-rain)",
              type: "bar",
              points: monthlyActual.map((value, index) => ({
                label: MONTH_LABELS[index],
                value,
              })),
            },
            {
              id: "normal",
              label: `Normal (${normals.data.period})`,
              color: "var(--chart-normal)",
              type: "line",
              points: monthlyActual.map((unused, index) => {
                const normal = normals.data?.months[index]?.rainMmPerDay ?? null;
                const daysInMonth = new Date(year, index + 1, 0).getDate();
                return {
                  label: MONTH_LABELS[index],
                  value: normal === null ? null : normal * daysInMonth,
                };
              }),
            },
          ]}
          title={`Monthly Rainfall — ${year} vs. Normal`}
          unit="mm"
        />
      ) : null}

      <div className="kpi-grid">
        <div className="kpi-tile">
          <span className="kpi-tile-label">
            Growing degree days (90 days) <EstimateBadge title={estimateFormulas.growingDegreeDays} />
          </span>
          <span className="kpi-tile-value">{gdd === null ? "—" : formatNumber(gdd)}</span>
          <span className="kpi-tile-note">Base temperature: 10°C</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-tile-label">
            Frost days (90 days) <EstimateBadge title={estimateFormulas.frostRiskDays} />
          </span>
          <span className="kpi-tile-value">{frost === null ? "—" : formatNumber(frost)}</span>
          <span className="kpi-tile-note">nights at or below 0°C</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-tile-label">
            Dryness <EstimateBadge title={estimateFormulas.drynessIndex} />
          </span>
          <span className="kpi-tile-value">{dryness === null ? "—" : formatNumber(dryness, 2)}</span>
          <span className="kpi-tile-note">
            {dryness === null ? "Normals required" : drynessLabel(dryness)}
          </span>
        </div>
      </div>
    </>
  );
}
