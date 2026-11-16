import type { FieldGeometry } from "@/lib/fields/types";

export const soilCropIds = [
  "corn",
  "soybean",
  "winter-wheat",
  "canola",
  "forage",
] as const;

export type SoilCropId = (typeof soilCropIds)[number];
export type SoilSuitabilityRating =
  | "Good"
  | "Moderate"
  | "Limited"
  | "Insufficient data";

export type SoilComponentSummary = {
  soilId: string;
  soilName: string | null;
  percent: number;
  drainageCode: string | null;
  drainage: string | null;
  parentMaterial: string | null;
};

export type PreparedSoilRegionProperties = {
  polyId: string;
  source: "AAFC CanSIS SLC v3.2";
  scale: "1:1,000,000";
  dominantSoil: string | null;
  dominantPercent: number | null;
  drainageCode: string | null;
  drainage: string | null;
  sand: number | null;
  silt: number | null;
  clay: number | null;
  ph: number | null;
  phMethod: string | null;
  organicCarbon: number | null;
  rootDepthCode: string | null;
  rootDepth: string | null;
  components: SoilComponentSummary[];
  bbox: [number, number, number, number];
};

export type SoilRegionProperties = PreparedSoilRegionProperties & {
  crop: SoilCropId;
  cropLabel: string;
  rating: SoilSuitabilityRating;
  limitingFactors: string[];
  overlapPercent: number | null;
  note: "Regional estimate, not a soil test";
};

export type SoilRegionFeature = {
  type: "Feature";
  id: string;
  properties: SoilRegionProperties;
  geometry: FieldGeometry;
};

export type SoilRegionCollection = {
  type: "FeatureCollection";
  features: SoilRegionFeature[];
};

