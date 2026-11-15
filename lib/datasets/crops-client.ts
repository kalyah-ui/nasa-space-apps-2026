import type { FieldSoilContext } from "../recommendations/field-fit";

export type CropWaterDemand = "lower" | "moderate" | "higher" | "unknown";
export type CropClassificationMethod = "gemini" | "crop-reference" | "manual";

export interface CropClassification {
  crop_name: string;
  family: string | null;
  water_demand: CropWaterDemand;
  family_method: CropClassificationMethod;
  water_method: CropClassificationMethod;
  note: string;
}

export interface CropClassificationResult {
  classifications: CropClassification[];
  provider: "gemini" | "crop-reference";
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function classifyCrops(
  cropNames: string[],
  fieldSoil?: FieldSoilContext | null,
  signal?: AbortSignal,
): Promise<CropClassificationResult> {
  const response = await fetch(`${apiBaseUrl}/api/crops/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      crop_names: cropNames,
      field_context: fieldSoil ? {
        region: "Ontario, Canada",
        sand_pct: fieldSoil.sandPct,
        silt_pct: fieldSoil.siltPct,
        clay_pct: fieldSoil.clayPct,
        ph_cacl2: fieldSoil.phCacl2,
      } : undefined,
    }),
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Crop classification request failed (${response.status}).`);
  }
  return response.json() as Promise<CropClassificationResult>;
}
