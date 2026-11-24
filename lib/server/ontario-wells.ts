import type { NearbyWells, WellRecord } from "../datasets/wells-types";

export const ONTARIO_WELLS_QUERY = "https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/MOE/Wells/MapServer/0/query";
export const WELL_RADIUS_M = 1000;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

export function parseWellLocation(latitude: string | null, longitude: string | null) {
  const lat = latitude?.trim() ? Number(latitude) : NaN;
  const lon = longitude?.trim() ? Number(longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error("Valid latitude and longitude are required.");
  }
  return { latitude: lat, longitude: lon };
}

function distanceMeters(latitude: number, longitude: number, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin((lat - latitude) * rad / 2) ** 2 + Math.cos(latitude * rad) * Math.cos(lat * rad) * Math.sin((lon - longitude) * rad / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function parseWellRecords(payload: unknown, latitude: number, longitude: number): { records: WellRecord[]; complete: boolean } {
  const body = record(payload);
  if (body.error || !Array.isArray(body.features)) throw new Error("Ontario well records are temporarily unavailable.");
  const wells: WellRecord[] = [];
  for (const feature of body.features) {
    const { attributes, geometry } = record(feature);
    const properties = record(attributes), point = record(geometry);
    const lat = number(point.y), lon = number(point.x), id = text(properties.WELL_ID);
    if (!id || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const distance = distanceMeters(latitude, longitude, lat, lon);
    if (distance > WELL_RADIUS_M) continue;
    const depth = number(properties.DEPTH_M), year = number(properties.COMPLETED_YEAR);
    wells.push({ id, distance_m: Math.round(distance), depth_m: depth !== null && depth >= 0 ? depth : null,
      completed_year: year !== null && Number.isInteger(year) && year >= 1800 && year <= new Date().getUTCFullYear() ? year : null,
      recorded_status: text(properties.FINAL_STATUS_DESCR), recorded_use: text(properties.USE1) });
  }
  wells.sort((a, b) => a.distance_m - b.distance_m || a.id.localeCompare(b.id));
  return { records: wells.slice(0, 5), complete: body.exceededTransferLimit !== true };
}

export async function fetchOntarioWells(latitude: number, longitude: number, fetcher = fetch): Promise<NearbyWells> {
  const params = new URLSearchParams({ f: "json", where: "1=1", geometry: `${longitude},${latitude}`,
    geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: String(WELL_RADIUS_M), units: "esriSRUnit_Meter" });
  const countParams = new URLSearchParams(params);
  countParams.set("returnCountOnly", "true");
  const featureParams = new URLSearchParams(params);
  featureParams.set("outFields", "WELL_ID,DEPTH_M,COMPLETED_YEAR,FINAL_STATUS_DESCR,USE1");
  featureParams.set("outSR", "4326");
  featureParams.set("returnGeometry", "true");
  featureParams.set("resultRecordCount", "2000");
  const load = async (query: URLSearchParams) => {
    const response = await fetcher(`${ONTARIO_WELLS_QUERY}?${query}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) throw new Error("Ontario well records are temporarily unavailable.");
    const result = record(await response.json());
    if (result.error) throw new Error("Ontario well records are temporarily unavailable.");
    return result;
  };
  const [countResult, features] = await Promise.all([load(countParams), load(featureParams)]);
  const count = number(countResult.count);
  if (count === null || !Number.isInteger(count) || count < 0) throw new Error("Ontario returned an invalid well record count.");
  return { total_records: count, radius_m: WELL_RADIUS_M, ...parseWellRecords(features, latitude, longitude), retrieved_at: new Date().toISOString() };
}
