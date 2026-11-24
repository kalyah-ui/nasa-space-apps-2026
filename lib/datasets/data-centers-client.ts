export type DataCenterAssessmentStatus = "reported" | "sources_only" | "no_reports_found" | "unavailable" | "error";
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
  searched_at?: string;
  summary_status?: "not_configured" | "unavailable";
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
  provider: "tavily" | "gemini-google-search" | "unavailable";
  search_suggestions_html?: string[];
}

export interface NearbyDataCenterInput {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  province?: string;
  country?: string;
  farmAddress?: string | null;
  isDemoLocation?: boolean;
}

const resultCache = new Map<string, { expires: number; result: FarmScopeAssessment }>();
const pendingRequests = new Map<string, Promise<FarmScopeAssessment>>();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function searchBody(input: NearbyDataCenterInput) {
  return { latitude: input.latitude, longitude: input.longitude, radius_km: input.radiusKm ?? 10,
    province: input.province ?? "Ontario", country: input.country ?? "Canada",
    farm_address: input.farmAddress ?? null, is_demo_location: input.isDemoLocation ?? false };
}
function resultKey(input: NearbyDataCenterInput) { return `loam-nearby-v5:${JSON.stringify(searchBody(input))}`; }

export function getCachedNearbyDataCenters(input: NearbyDataCenterInput): FarmScopeAssessment | null {
  const key = resultKey(input);
  let entry = resultCache.get(key);
  if (!entry && typeof window !== "undefined") {
    try { entry = JSON.parse(window.sessionStorage.getItem(key) ?? "null") ?? undefined; } catch { /* Storage unavailable. */ }
  }
  if (entry && typeof entry.expires === "number" && entry.expires > Date.now() && entry.result?.provider === "tavily") {
    resultCache.set(key, entry);
    return entry.result;
  }
  resultCache.delete(key);
  return null;
}

export function clearCachedNearbyAnalysis(input: NearbyDataCenterInput): void {
  // Manual retries only clear incomplete browser results. The server's Tavily
  // evidence cache and completed reports are preserved.
  const cached = getCachedNearbyDataCenters(input);
  if (cached && cached.assessment_status !== "sources_only") return;
  const key = resultKey(input);
  resultCache.delete(key);
  if (typeof window !== "undefined") {
    try { window.sessionStorage.removeItem(key); } catch { /* Storage unavailable. */ }
  }
}

export async function lookupNearbyDataCenters(input: NearbyDataCenterInput, signal?: AbortSignal): Promise<FarmScopeAssessment> {
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const cached = getCachedNearbyDataCenters(input);
  if (cached) return cached;
  const key = resultKey(input);
  let pending = pendingRequests.get(key);
  if (!pending) {
    pending = (async () => {
      // Keep shared work alive when a card unmounts, so revisiting it does not
      // start another provider request. Each caller still respects its signal.
      const response = await fetch("/api/infrastructure/data-centers/nearby", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchBody(input)), cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.message === "string" ? body.message : `Nearby infrastructure assessment failed (${response.status}).`);
      }
      const result = await response.json() as FarmScopeAssessment;
      // Incomplete analysis can recover soon; its Tavily evidence stays cached
      // on the server for a week, so retrying analysis does not repeat search.
      const searchedAt = Date.parse(result.searched_at ?? "");
      const expires = result.assessment_status === "sources_only" ? Date.now() + 5 * 60_000
        : Math.min(Date.now() + WEEK_MS, Number.isFinite(searchedAt) ? searchedAt + WEEK_MS : Infinity);
      const entry = { result, expires };
      if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value!);
      resultCache.set(key, entry);
      if (typeof window !== "undefined") {
        try {
          const oldKeys = Object.keys(window.sessionStorage).filter((name) => name.startsWith("loam-nearby-v5:"));
          if (oldKeys.length >= 50) window.sessionStorage.removeItem(oldKeys[0]);
          window.sessionStorage.setItem(key, JSON.stringify(entry));
        } catch { /* In-memory cache remains available if storage is full or disabled. */ }
      }
      return result;
    })();
    pendingRequests.set(key, pending);
  }
  try {
    const result = await pending;
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    return result;
  } finally {
    if (pendingRequests.get(key) === pending) pendingRequests.delete(key);
  }
}
