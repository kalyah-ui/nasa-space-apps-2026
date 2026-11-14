import {
  type ClimateNormals,
  type DailyHistory,
  type DailyHistoryDay,
  type Forecast,
  type ForecastDay,
  type MonthlyNormal,
  type WeatherProvider,
  type WeatherSource,
  WeatherSourceError,
} from "./types";

const POWER_BASE = "https://power.larc.nasa.gov/api/temporal";
const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
const POWER_PARAMETERS = "PRECTOTCORR,T2M,T2M_MIN,T2M_MAX,ALLSKY_SFC_SW_DWN";
const POWER_FILL_VALUE = -999;
const REQUEST_TIMEOUT_MS = 15_000;

/* Cache TTLs: history/normals change at most daily; forecasts hourly.
   Caching also keeps us well inside both services' free-tier request limits
   (Open-Meteo: <10k/day; POWER asks bulk users not to hammer one grid cell). */
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
const NORMALS_TTL_MS = 24 * 60 * 60 * 1000;
const FORECAST_TTL_MS = 30 * 60 * 1000;

const MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

type CacheEntry = { expiresAt: number; value: Promise<unknown> };

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value !== POWER_FILL_VALUE
    ? value
    : null;
}

/** YYYYMMDD for POWER request/response keys. */
function toPowerDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function toIsoDate(powerDate: string): string {
  return `${powerDate.slice(0, 4)}-${powerDate.slice(4, 6)}-${powerDate.slice(6, 8)}`;
}

async function fetchJson(url: string, source: WeatherSource): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
    throw new WeatherSourceError(source, `Request to ${source} ${reason}.`);
  }
  if (!response.ok) {
    throw new WeatherSourceError(
      source,
      `${source} responded with HTTP ${response.status}.`,
      response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new WeatherSourceError(source, `${source} returned a response that is not valid JSON.`);
  }
}

/** POWER responses nest values under properties.parameter.<NAME>.<DATE|MONTH>. */
function powerParameter(payload: unknown, name: string, source: WeatherSource): Record<string, unknown> {
  const parameter = (payload as { properties?: { parameter?: Record<string, unknown> } })
    ?.properties?.parameter?.[name];
  if (typeof parameter !== "object" || parameter === null) {
    throw new WeatherSourceError(source, `${source} response is missing the "${name}" parameter.`);
  }
  return parameter as Record<string, unknown>;
}

export class LiveWeatherProvider implements WeatherProvider {
  private readonly cache = new Map<string, CacheEntry>();

  async getDailyHistory(latitude: number, longitude: number, days = 90): Promise<DailyHistory> {
    return this.cached("history", latitude, longitude, HISTORY_TTL_MS, `${days}`, async () => {
      const end = new Date();
      const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
      const url =
        `${POWER_BASE}/daily/point?parameters=${POWER_PARAMETERS}&community=ag` +
        `&longitude=${longitude}&latitude=${latitude}` +
        `&start=${toPowerDate(start)}&end=${toPowerDate(end)}&format=JSON`;
      const payload = await fetchJson(url, "nasa-power");

      const rain = powerParameter(payload, "PRECTOTCORR", "nasa-power");
      const tMean = powerParameter(payload, "T2M", "nasa-power");
      const tMin = powerParameter(payload, "T2M_MIN", "nasa-power");
      const tMax = powerParameter(payload, "T2M_MAX", "nasa-power");
      const solar = powerParameter(payload, "ALLSKY_SFC_SW_DWN", "nasa-power");

      const parsedDays: DailyHistoryDay[] = Object.keys(tMean)
        .sort()
        .map((date) => ({
          date: toIsoDate(date),
          rainMm: numberOrNull(rain[date]),
          tMeanC: numberOrNull(tMean[date]),
          tMinC: numberOrNull(tMin[date]),
          tMaxC: numberOrNull(tMax[date]),
          solarMjM2: numberOrNull(solar[date]),
        }));

      // POWER lags real time by a few days; drop the trailing not-yet-reported rows.
      while (parsedDays.length > 0) {
        const last = parsedDays[parsedDays.length - 1];
        if (last.rainMm !== null || last.tMeanC !== null) {
          break;
        }
        parsedDays.pop();
      }

      return {
        source: "nasa-power" as const,
        latitude,
        longitude,
        start: parsedDays[0]?.date ?? toIsoDate(toPowerDate(start)),
        end: parsedDays[parsedDays.length - 1]?.date ?? toIsoDate(toPowerDate(end)),
        days: parsedDays,
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  async getClimateNormals(latitude: number, longitude: number): Promise<ClimateNormals> {
    return this.cached("normals", latitude, longitude, NORMALS_TTL_MS, "", async () => {
      const url =
        `${POWER_BASE}/climatology/point?parameters=${POWER_PARAMETERS}&community=ag` +
        `&longitude=${longitude}&latitude=${latitude}&format=JSON`;
      const payload = await fetchJson(url, "nasa-power");

      const rain = powerParameter(payload, "PRECTOTCORR", "nasa-power");
      const tMean = powerParameter(payload, "T2M", "nasa-power");
      const tMin = powerParameter(payload, "T2M_MIN", "nasa-power");
      const tMax = powerParameter(payload, "T2M_MAX", "nasa-power");
      const solar = powerParameter(payload, "ALLSKY_SFC_SW_DWN", "nasa-power");

      const months: MonthlyNormal[] = MONTH_KEYS.map((key, index) => ({
        month: index + 1,
        rainMmPerDay: numberOrNull(rain[key]),
        tMeanC: numberOrNull(tMean[key]),
        tExtremeMinC: numberOrNull(tMin[key]),
        tExtremeMaxC: numberOrNull(tMax[key]),
        solarMjM2: numberOrNull(solar[key]),
      }));

      const period =
        (payload as { header?: { range?: string } })?.header?.range ?? "long-term climatology";

      return {
        source: "nasa-power" as const,
        latitude,
        longitude,
        period,
        months,
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  async getForecast(latitude: number, longitude: number): Promise<Forecast> {
    return this.cached("forecast", latitude, longitude, FORECAST_TTL_MS, "", async () => {
      const url =
        `${OPEN_METEO_BASE}?latitude=${latitude}&longitude=${longitude}` +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,weather_code" +
        "&hourly=soil_moisture_3_to_9cm,soil_temperature_6cm" +
        "&forecast_days=7&timezone=auto";
      const payload = (await fetchJson(url, "open-meteo")) as {
        timezone?: string;
        daily?: {
          time?: string[];
          temperature_2m_max?: Array<number | null>;
          temperature_2m_min?: Array<number | null>;
          precipitation_sum?: Array<number | null>;
          et0_fao_evapotranspiration?: Array<number | null>;
          weather_code?: Array<number | null>;
        };
        hourly?: {
          time?: string[];
          soil_moisture_3_to_9cm?: Array<number | null>;
          soil_temperature_6cm?: Array<number | null>;
        };
      };

      const daily = payload.daily;
      if (!daily?.time) {
        throw new WeatherSourceError("open-meteo", "open-meteo response is missing daily data.");
      }

      // Average the hourly soil series into per-date means.
      const soilByDate = new Map<string, { moisture: number[]; temperature: number[] }>();
      const hourlyTimes = payload.hourly?.time ?? [];
      hourlyTimes.forEach((time, index) => {
        const date = time.slice(0, 10);
        const bucket = soilByDate.get(date) ?? { moisture: [], temperature: [] };
        const moisture = payload.hourly?.soil_moisture_3_to_9cm?.[index];
        const temperature = payload.hourly?.soil_temperature_6cm?.[index];
        if (typeof moisture === "number") {
          bucket.moisture.push(moisture);
        }
        if (typeof temperature === "number") {
          bucket.temperature.push(temperature);
        }
        soilByDate.set(date, bucket);
      });
      const mean = (values: number[]): number | null =>
        values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

      const parsedDays: ForecastDay[] = daily.time.map((date, index) => ({
        date,
        tMinC: daily.temperature_2m_min?.[index] ?? null,
        tMaxC: daily.temperature_2m_max?.[index] ?? null,
        rainMm: daily.precipitation_sum?.[index] ?? null,
        et0Mm: daily.et0_fao_evapotranspiration?.[index] ?? null,
        weatherCode: daily.weather_code?.[index] ?? null,
        soilMoisture: mean(soilByDate.get(date)?.moisture ?? []),
        soilTempC: mean(soilByDate.get(date)?.temperature ?? []),
      }));

      return {
        source: "open-meteo" as const,
        latitude,
        longitude,
        timezone: payload.timezone ?? "UTC",
        days: parsedDays,
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Promise-level cache: concurrent callers share one in-flight request, and
   * coordinates are rounded to ~100 m so nearby lookups hit the same entry.
   * Failed requests are evicted so a retry actually refetches.
   */
  private async cached<T>(
    kind: string,
    latitude: number,
    longitude: number,
    ttlMs: number,
    extra: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = `${kind}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${extra}`;
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.value as Promise<T>;
    }
    const value = load();
    this.cache.set(key, { expiresAt: Date.now() + ttlMs, value });
    try {
      return await value;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }
}

/** Shared instance so Discovery and Field Info reuse one cache. */
export const weatherProvider: WeatherProvider = new LiveWeatherProvider();
