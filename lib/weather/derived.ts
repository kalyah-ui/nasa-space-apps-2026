/**
 * Derived agronomic metrics, computed in the frontend from the raw series.
 *
 * Everything here is an ESTIMATE from simple textbook formulas — not an
 * agronomic model. The UI must label these values "Estimate" and can show the
 * matching entry from `estimateFormulas` in a tooltip.
 */

import type { ClimateNormals, DailyHistoryDay, ForecastDay } from "./types";

export const estimateFormulas = {
  growingDegreeDays:
    "GDD = Σ max(0, (min(Tmax, 30°C) + Tmin) / 2 − 10°C) over the period. Base 10°C, ceiling 30°C (common corn/soy convention).",
  frostRiskDays: "Days in the period with Tmin ≤ 0°C.",
  daysToNextFrost: "First forecast day with Tmin ≤ 2°C (2°C margin for ground frost).",
  drynessIndex:
    "Last-30-day rainfall ÷ long-term normal rainfall for the same calendar window. Below 1.0 = drier than normal.",
  rainfall30Day: "Sum of daily rainfall over the most recent 30 reported days.",
  averageTemperature30Day: "Mean of daily mean temperature over the most recent 30 reported days.",
} as const;

/** Most recent `count` days that actually have data for `key`. */
function recentWithData(
  days: DailyHistoryDay[],
  key: "rainMm" | "tMeanC" | "tMinC",
  count: number,
): DailyHistoryDay[] {
  return days.filter((day) => day[key] !== null).slice(-count);
}

/** Total rainfall (mm) over the most recent `count` reported days; null if no data. */
export function rainfallTotal(days: DailyHistoryDay[], count = 30): number | null {
  const window = recentWithData(days, "rainMm", count);
  if (window.length === 0) {
    return null;
  }
  return window.reduce((sum, day) => sum + (day.rainMm ?? 0), 0);
}

/** Mean of daily mean temperature (°C) over the most recent `count` reported days. */
export function averageTemperature(days: DailyHistoryDay[], count = 30): number | null {
  const window = recentWithData(days, "tMeanC", count);
  if (window.length === 0) {
    return null;
  }
  return window.reduce((sum, day) => sum + (day.tMeanC ?? 0), 0) / window.length;
}

/**
 * Growing degree days, base 10°C with a 30°C ceiling on Tmax.
 * Days missing either temperature are skipped.
 */
export function growingDegreeDays(days: DailyHistoryDay[], baseC = 10, ceilingC = 30): number | null {
  let total = 0;
  let counted = 0;
  for (const day of days) {
    if (day.tMinC === null || day.tMaxC === null) {
      continue;
    }
    const cappedMax = Math.min(day.tMaxC, ceilingC);
    total += Math.max(0, (cappedMax + day.tMinC) / 2 - baseC);
    counted += 1;
  }
  return counted > 0 ? total : null;
}

/** Number of days in the series with Tmin at or below `thresholdC`. */
export function frostRiskDays(days: DailyHistoryDay[], thresholdC = 0): number | null {
  const reported = days.filter((day) => day.tMinC !== null);
  if (reported.length === 0) {
    return null;
  }
  return reported.filter((day) => (day.tMinC as number) <= thresholdC).length;
}

/**
 * Days until the first forecast day with Tmin ≤ `thresholdC`.
 * 0 = today. null = no frost risk inside the forecast window (report the
 * window length alongside, e.g. "none in next 7 days").
 */
export function daysToNextFrost(days: ForecastDay[], thresholdC = 2): number | null {
  const index = days.findIndex((day) => day.tMinC !== null && day.tMinC <= thresholdC);
  return index === -1 ? null : index;
}

/**
 * Dryness indicator: recent 30-day rainfall as a fraction of the long-term
 * normal for the same calendar window (weighting normals by how many of the
 * window's days fall in each month). 1.0 = normal, below 1.0 = drier.
 */
export function drynessIndex(
  days: DailyHistoryDay[],
  normals: ClimateNormals,
  count = 30,
): number | null {
  const window = recentWithData(days, "rainMm", count);
  if (window.length === 0) {
    return null;
  }

  const actual = window.reduce((sum, day) => sum + (day.rainMm ?? 0), 0);

  let expected = 0;
  for (const day of window) {
    const month = Number(day.date.slice(5, 7));
    const normal = normals.months.find((entry) => entry.month === month)?.rainMmPerDay;
    if (normal === null || normal === undefined) {
      return null;
    }
    expected += normal;
  }
  if (expected <= 0) {
    return null;
  }
  return actual / expected;
}

/** Plain-language bucket for a dryness index value, in the Farmish voice. */
export function drynessLabel(index: number): string {
  if (index < 0.4) {
    return "Bone dry";
  }
  if (index < 0.75) {
    return "Drier than normal";
  }
  if (index <= 1.3) {
    return "About normal";
  }
  if (index <= 2) {
    return "Wetter than normal";
  }
  return "Soaked";
}
