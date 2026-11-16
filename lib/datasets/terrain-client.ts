import type { FieldOption } from "../fields/field-catalog";

export interface TerrainSample {
  field_id: string;
  field_name: string;
  mean_elevation_m: number;
  mean_slope_degrees: number | null;
  sample_count: number;
  source_object: string;
  source_updated_at: string | null;
  soil_landscapes: SoilLandscapeObservation[];
  crop_class_counts: CropClassCount[];
  crop_sample_count: number;
  landsat_observation: LandsatObservation | null;
  flood_map_studies: FloodMapStudyObservation[];
  hydrology_observation?: HydrologyObservation | null;
  sources: SourceExtraction[];
}

export interface HydrologyObservation {
  station_number: string;
  station_name: string;
  distance_km: number;
  observed_on: string;
  daily_flow_m3_s: number;
  flow_symbol: string | null;
}

export interface LandsatObservation {
  scene_id: string;
  acquired_at: string;
  mean_ndvi: number;
  clear_pixel_count: number;
}

export interface FloodMapStudyObservation {
  province_or_territory: string;
  study_name: string;
  study_date: string | null;
  availability_status: string | null;
  study_status: string | null;
  public_link: string | null;
}

export interface SoilComponent {
  soil_id: string;
  soil_name: string | null;
  composition_pct: number;
  drainage_code: string | null;
  parent_material_texture_codes: string[];
  landform_type_codes: string[];
  landform_slope_codes: string[];
  cropped_codes: string[];
  surface_horizon: {
    layer_no: number;
    upper_depth_cm: number | null;
    lower_depth_cm: number | null;
    sand_pct: number | null;
    silt_pct: number | null;
    clay_pct: number | null;
    organic_carbon_pct: number | null;
    ph_cacl2: number | null;
    ph_water: number | null;
  } | null;
}

export interface SoilLandscapeObservation {
  polygon_id: number;
  field_overlap_pct: number;
  components: SoilComponent[];
}

export interface CropClassCount {
  class_code: number;
  pixel_count: number;
  field_share_pct: number;
  label?: string | null;
}

export interface SourceExtraction {
  source_id: string;
  label: string;
  status: "extracted" | "unavailable" | "error";
  detail: string;
  source_objects: string[];
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const ottawaSceneManifestObject =
  "raw/landsat-surface-reflectance-collection-2-level-2-ontario/landsat-sample/LC08_L2SP_016028_20260923_02_T1/manifest.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Older backend revisions omit newer observations; validate before rendering. */
export function normalizeTerrainSample(value: unknown): TerrainSample {
  if (!isRecord(value) || !Array.isArray(value.soil_landscapes) || !Array.isArray(value.sources)) {
    throw new Error("The terrain service returned an invalid response. Expected soil landscapes and source information.");
  }
  for (const key of ["crop_class_counts", "flood_map_studies"] as const) {
    if (value[key] != null && !Array.isArray(value[key])) {
      throw new Error(`The terrain service returned an invalid ${key} list.`);
    }
  }
  return {
    ...value,
    crop_class_counts: value.crop_class_counts ?? [],
    flood_map_studies: value.flood_map_studies ?? [],
  } as unknown as TerrainSample;
}

function sceneCoordinate(value: unknown, label: string): [number, number] {
  if (
    !Array.isArray(value) ||
    typeof value[0] !== "number" ||
    !Number.isFinite(value[0]) ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[1])
  ) {
    throw new Error(`The Ottawa Landsat manifest has an invalid ${label} coordinate.`);
  }
  return [value[0], value[1]];
}

export async function loadOttawaLandsatSceneField(signal?: AbortSignal): Promise<FieldOption> {
  const objectPath = ottawaSceneManifestObject.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${apiBaseUrl}/api/data/objects/${objectPath}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Could not load the Ottawa Landsat manifest (${response.status}).`);
  }

  const manifest: unknown = await response.json();
  if (!isRecord(manifest) || !isRecord(manifest.boundsWgs84)) {
    throw new Error("The Ottawa Landsat manifest does not contain scene bounds.");
  }
  const bounds = manifest.boundsWgs84;
  const southwest = sceneCoordinate(bounds.southwest, "southwest");
  const southeast = sceneCoordinate(bounds.southeast, "southeast");
  const northeast = sceneCoordinate(bounds.northeast, "northeast");
  const northwest = sceneCoordinate(bounds.northwest, "northwest");

  return {
    id: "ottawa-valley-landsat-scene",
    name: "Ottawa Valley Landsat scene",
    geometry: {
      type: "Polygon",
      coordinates: [[southwest, southeast, northeast, northwest, southwest]],
    },
  };
}

export async function getTerrainSample(field: FieldOption, signal?: AbortSignal): Promise<TerrainSample> {
  const url = new URL(`${apiBaseUrl}/api/data/terrain`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field_id: field.id,
      field_name: field.name,
      geometry: field.geometry,
    }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Terrain request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the HTTP status when the API does not return JSON.
    }
    throw new Error(message);
  }

  return normalizeTerrainSample(await response.json());
}
