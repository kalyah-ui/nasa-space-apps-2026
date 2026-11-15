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
  sources: SourceExtraction[];
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
}

export interface SourceExtraction {
  source_id: string;
  label: string;
  status: "extracted" | "unavailable" | "error";
  detail: string;
  source_objects: string[];
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

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

  return response.json() as Promise<TerrainSample>;
}
