"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink } from "lucide-react";
import { clearCachedNearbyAnalysis, getCachedNearbyDataCenters, lookupNearbyDataCenters, type DataCenterFacility, type FarmScopeAssessment } from "@/lib/datasets/data-centers-client";
import type { DemoListing } from "./listings/demo-listings";

const SCREENING_RADIUS_KM = 10;
const provinces: Record<DemoListing["province"], string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", ON: "Ontario",
  PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan",
};
const statusLabels: Record<DataCenterFacility["status"], string> = {
  operational: "Operational", under_construction: "Under construction", approved: "Approved",
  submitted: "Application submitted", proposed: "Proposed", announced: "Announced",
  cancelled: "Cancelled", unverified: "Status unverified",
};

function SourceLinks({ sources }: { sources: FarmScopeAssessment["sources"] }) {
  const unique = [...new Map(sources.map((source) => [source.url, source])).values()];
  return (
    <div className="infrastructure-sources">
      {unique.slice(0, 2).map((source) => (
        <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
          {source.title}<ExternalLink aria-hidden="true" size={12} />
        </a>
      ))}
    </div>
  );
}

function FacilityCard({ facility }: { facility: DataCenterFacility }) {
  return (
    <li className="infrastructure-facility-card">
      <div className="infrastructure-facility-topline">
        <strong>{facility.name}</strong>
        <span>{statusLabels[facility.status]}</span>
      </div>
      <p className="infrastructure-facility-meta">About {facility.distance_km?.toFixed(1)} km away{facility.company ? ` · ${facility.company}` : ""}</p>
      <p>{facility.evidence_summary}</p>
      <SourceLinks sources={facility.sources} />
    </li>
  );
}

export function DataCenterSignal({ listing }: { listing: DemoListing }) {
  const province = provinces[listing.province];
  const [attempt, setAttempt] = useState(0);
  const searchInput = { latitude: listing.latitude, longitude: listing.longitude,
    radiusKm: SCREENING_RADIUS_KM, province, country: "Canada", isDemoLocation: true };
  const [assessment, setAssessment] = useState<FarmScopeAssessment | null>(() => getCachedNearbyDataCenters(searchInput));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !getCachedNearbyDataCenters(searchInput));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const cached = getCachedNearbyDataCenters({ latitude: listing.latitude, longitude: listing.longitude,
      radiusKm: SCREENING_RADIUS_KM, province, country: "Canada", isDemoLocation: true });
    setError(null);
    if (cached) {
      setAssessment(cached);
      setLoading(false);
      return () => { active = false; controller.abort(); };
    }
    setLoading(true);
    setAssessment(null);
    void lookupNearbyDataCenters({
      latitude: listing.latitude, longitude: listing.longitude,
      radiusKm: SCREENING_RADIUS_KM, province, country: "Canada", isDemoLocation: true,
    }, controller.signal)
      .then((result) => { if (active) setAssessment(result); })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to check nearby projects.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [listing.latitude, listing.longitude, province, attempt]);

  const facilities = [...assessment?.existing_data_centers ?? [], ...assessment?.planned_data_centers ?? []]
    .filter((facility) => facility.distance_km !== null && facility.distance_km <= SCREENING_RADIUS_KM)
    .sort((a, b) => a.distance_km! - b.distance_km!);
  const considerations = assessment ? [
    ...assessment.water_concerns, ...assessment.energy_concerns,
    ...assessment.land_use_concerns, ...assessment.environmental_concerns,
  ].filter((finding) => finding.documented).slice(0, 3) : [];

  const incomplete = assessment?.assessment_status === "sources_only" || assessment?.assessment_status === "unavailable" || assessment?.assessment_status === "error";
  const status = incomplete ? "unknown" : facilities.length > 0 ? "review" : "clear";
  const StatusIcon = status === "unknown" ? CircleHelp : status === "review" ? AlertTriangle : CheckCircle2;

  return (
    <section aria-labelledby="data-center-signal-title" className="infrastructure-signal">
      <span className="kpi-tile-label">Nearby development</span>
      <h3 id="data-center-signal-title">Nearby data centers</h3>
      <p className="infrastructure-demo-note">Demo location · {SCREENING_RADIUS_KM} km screening radius</p>
      {loading && <p className="infrastructure-result-note" role="status">Loading nearby development report…</p>}
      {error && <>
        <p className="rotation-error" role="alert">{error}</p>
        <button className="crop-add-button" onClick={() => setAttempt((value) => value + 1)} type="button">Retry search</button>
      </>}
      {assessment && <>
        <div className={`infrastructure-screening-status is-${status}`} role="status">
          <StatusIcon aria-hidden="true" size={22} />
          <div>
            <strong>{status === "unknown" ? "Nearby development not assessed"
              : status === "review" ? "Nearby project identified" : "No nearby projects identified"}</strong>
            <p>{status === "unknown" ? "Analysis is unavailable. Try again before drawing conclusions."
              : status === "review" ? `A data center or proposal was found within ${SCREENING_RADIUS_KM} km. Review its location and plans before making a land decision.`
                : `Our search found no verified data centers or proposals within ${SCREENING_RADIUS_KM} km. Local planning records can help confirm.`}</p>
          </div>
        </div>
        {facilities.length > 0 ? <>
          <p className="infrastructure-result-note">{facilities.length} source-located {facilities.length === 1 ? "facility or project" : "facilities or projects"} within {SCREENING_RADIUS_KM} km.</p>
          <ul className="infrastructure-facility-list">
            {facilities.slice(0, 3).map((facility) => <FacilityCard facility={facility} key={facility.name} />)}
          </ul>
          {facilities.length > 3 && <details className="infrastructure-assessment-block">
            <summary>Show {facilities.length - 3} more nearby projects</summary>
            <ul className="infrastructure-facility-list">
              {facilities.slice(3).map((facility) => <FacilityCard facility={facility} key={facility.name} />)}
            </ul>
          </details>}
          {considerations.length > 0 && <details className="infrastructure-assessment-block">
            <summary>Reported project considerations</summary>
            <ul className="infrastructure-finding-list">
              {considerations.map((finding, index) => <li key={index}>
                <span>{finding.finding}</span><SourceLinks sources={finding.sources} />
              </li>)}
            </ul>
          </details>}
        </> : null}
        {assessment.assessment_status === "sources_only" && assessment.summary_status === "unavailable" && (
          <button className="crop-add-button" disabled={loading} onClick={() => {
            clearCachedNearbyAnalysis(searchInput);
            setAttempt((value) => value + 1);
          }} type="button">Retry analysis</button>
        )}
        {!incomplete && <p className="infrastructure-result-note">Search screening, not a safety rating. Any farm impact needs a site-specific review.</p>}
        {assessment.searched_at && <p className="infrastructure-result-note">
          Last searched <time dateTime={assessment.searched_at}>{new Date(assessment.searched_at).toLocaleDateString()}</time> · Search sources cached for 7 days.
        </p>}
      </>}
    </section>
  );
}
