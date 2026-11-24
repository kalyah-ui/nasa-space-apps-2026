export type DataCenterAssessmentStatus = "reported" | "no_reports_found" | "unavailable" | "error";
export type DataCenterFacilityStatus = "operational" | "under_construction" | "approved" | "submitted" | "proposed" | "announced" | "cancelled" | "unverified";
export type PurchaseRecommendation =
  | "No identified data center concerns"
  | "Routine due diligence recommended"
  | "Additional investigation recommended"
  | "Significant documented concerns requiring specialist review"
  | "Insufficient evidence to assess";

export interface DataCenterSource {
  title: string;
  url: string;
  publication_date: string | null;
}

export interface DataCenterFacility {
  name: string;
  company: string | null;
  status: DataCenterFacilityStatus;
  facility_type: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_km: number | null;
  distance_is_approximate: boolean;
  announcement_date: string | null;
  expected_construction_date: string | null;
  expected_completion_date: string | null;
  municipal_approvals: string[];
  power_information: string | null;
  cooling_and_water_information: string | null;
  evidence_summary: string;
  sources: DataCenterSource[];
}

export interface EvidenceFinding {
  finding: string;
  documented: boolean;
  sources: DataCenterSource[];
}

export interface ExposureFactor {
  factor: string;
  weight_pct: number;
  score: number | null;
  rationale: string;
  sources: DataCenterSource[];
}

export interface FarmScopeAssessment {
  assessment_status: DataCenterAssessmentStatus;
  farm_location: {
    latitude: number;
    longitude: number;
    address: string | null;
    province: string;
    country: string;
    is_demo_location: boolean;
  };
  assessment_date: string;
  search_radius_km: number;
  existing_data_centers: DataCenterFacility[];
  planned_data_centers: DataCenterFacility[];
  closest_verified_facility_km: number | null;
  water_concerns: EvidenceFinding[];
  energy_concerns: EvidenceFinding[];
  land_use_concerns: EvidenceFinding[];
  environmental_concerns: EvidenceFinding[];
  exposure_factors: ExposureFactor[];
  exposure_score: number | null;
  score_confidence: "high" | "medium" | "low" | "insufficient";
  purchase_recommendation: PurchaseRecommendation;
  key_findings: Array<{ finding: string; sources: DataCenterSource[] }>;
  recommended_due_diligence: string[];
  data_gaps: string[];
  sources: DataCenterSource[];
  provider: "gemini-google-search" | "unavailable";
  search_suggestions_html?: string[];
}

export async function lookupNearbyDataCenters(
  input: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    province?: string;
    country?: string;
    farmAddress?: string | null;
    isDemoLocation?: boolean;
  },
  signal?: AbortSignal,
): Promise<FarmScopeAssessment> {
  const response = await fetch("/api/infrastructure/data-centers/nearby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude: input.latitude,
      longitude: input.longitude,
      radius_km: input.radiusKm ?? 25,
      province: input.province ?? "Ontario",
      country: input.country ?? "Canada",
      farm_address: input.farmAddress ?? null,
      is_demo_location: input.isDemoLocation ?? false,
    }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.message === "string" ? body.message : `Nearby infrastructure assessment failed (${response.status}).`);
  }
  return response.json() as Promise<FarmScopeAssessment>;
}
