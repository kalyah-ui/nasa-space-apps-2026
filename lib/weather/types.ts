/**
 * Shared weather/climate data contracts, used by the Discovery dashboard and
 * (later) the Field Info weather panel.
 *
 * Sources (both keyless):
 * - NASA POWER daily + climatology point APIs (history, long-term normals).
 * - Open-Meteo forecast API (7-day forecast, soil moisture/temperature, ET0).
 *
 * Verified against live responses on 2026-11-14 (POWER API v2.10, Open-Meteo v1).
 */

export type WeatherSource = "nasa-power" | "open-meteo";

/** Typed error so the UI can render per-source failures and retry buttons. */
export class WeatherSourceError extends Error {
  readonly source: WeatherSource;
  readonly status?: number;

  constructor(source: WeatherSource, message: string, status?: number) {
    super(message);
    this.name = "WeatherSourceError";
    this.source = source;
    this.status = status;
  }
}

export type DailyHistoryDay = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Precipitation, mm/day (POWER PRECTOTCORR). null = not yet reported. */
  rainMm: number | null;
  /** Mean temperature at 2 m, °C (T2M). */
  tMeanC: number | null;
  /** Minimum temperature at 2 m, °C (T2M_MIN). */
  tMinC: number | null;
  /** Maximum temperature at 2 m, °C (T2M_MAX). */
  tMaxC: number | null;
  /** All-sky shortwave irradiance, MJ/m²/day (ALLSKY_SFC_SW_DWN). */
  solarMjM2: number | null;
};

export type DailyHistory = {
  source: "nasa-power";
  latitude: number;
  longitude: number;
  /** ISO dates, inclusive. POWER lags real time by ~2–4 days. */
  start: string;
  end: string;
  days: DailyHistoryDay[];
  /** ISO timestamp of when this was fetched (for "last updated"). */
  fetchedAt: string;
};

export type MonthlyNormal = {
  /** 1–12. */
  month: number;
  /** Long-term mean precipitation, mm/day. */
  rainMmPerDay: number | null;
  /** Long-term mean temperature, °C. */
  tMeanC: number | null;
  /**
   * CAUTION: POWER climatology T2M_MIN / T2M_MAX are the period's record
   * extremes for the month, not mean daily min/max.
   */
  tExtremeMinC: number | null;
  tExtremeMaxC: number | null;
  /** Long-term mean irradiance, MJ/m²/day. */
  solarMjM2: number | null;
};

export type ClimateNormals = {
  source: "nasa-power";
  latitude: number;
  longitude: number;
  /** e.g. "January 2001 - December 2025", as reported by the API. */
  period: string;
  months: MonthlyNormal[];
  fetchedAt: string;
};

export type ForecastDay = {
  /** ISO date (YYYY-MM-DD), in the location's timezone. */
  date: string;
  tMinC: number | null;
  tMaxC: number | null;
  /** Precipitation sum, mm. */
  rainMm: number | null;
  /** FAO reference evapotranspiration, mm. */
  et0Mm: number | null;
  /** WMO weather interpretation code. */
  weatherCode: number | null;
  /** Daily mean of hourly soil moisture 3–9 cm, m³/m³. */
  soilMoisture: number | null;
  /** Daily mean of hourly soil temperature at 6 cm, °C. */
  soilTempC: number | null;
};

export type Forecast = {
  source: "open-meteo";
  latitude: number;
  longitude: number;
  timezone: string;
  days: ForecastDay[];
  fetchedAt: string;
};

export interface WeatherProvider {
  /** Daily history for the last `days` days (default 90). */
  getDailyHistory(latitude: number, longitude: number, days?: number): Promise<DailyHistory>;
  /** Long-term monthly normals. */
  getClimateNormals(latitude: number, longitude: number): Promise<ClimateNormals>;
  /** 7-day forecast including soil moisture/temperature and ET0. */
  getForecast(latitude: number, longitude: number): Promise<Forecast>;
}

export const SOURCE_ATTRIBUTION: Record<WeatherSource, { label: string; url: string }> = {
  "nasa-power": { label: "NASA POWER", url: "https://power.larc.nasa.gov/" },
  "open-meteo": { label: "Open-Meteo", url: "https://open-meteo.com/" },
};
