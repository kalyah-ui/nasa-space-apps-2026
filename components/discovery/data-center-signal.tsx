"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { lookupNearbyDataCenters, type DataCenterFacility, type EvidenceFinding, type FarmScopeAssessment } from "@/lib/datasets/data-centers-client";
import type { DemoListing } from "./listings/demo-listings";

type DataCenterSignalProps = { listing: DemoListing };

const statusLabels: Record<DataCenterFacility["status"], string> = {
  operational: "Operational",
  under_construction: "Under construction",
  approved: "Approved",
  submitted: "Application submitted",
  proposed: "Proposed",
  announced: "Announced",
  cancelled: "Cancelled",
  unverified: "Unverified",
};

const factorLabels: Record<string, string> = {
  existing_facility_proximity: "Existing facility proximity",
  development_pipeline: "Development pipeline",
  water_related_concerns: "Water-resource concerns",
  land_use_concerns: "Land-use concerns",
  energy_infrastructure_concerns: "Energy infrastructure",
  environmental_and_construction_concerns: "Environmental and construction concerns",
};

const exposureLabels: Record<number, string> = {
  0: "Very low identified exposure",
  21: "Low identified exposure",
  41: "Moderate identified exposure",
  61: "High identified exposure",
  81: "Very high identified exposure",
};

function exposureLabel(score: number): string {
  const threshold = [81, 61, 41, 21, 0].find((value) => score >= value) ?? 0;
  return exposureLabels[threshold];
}

function proximityBand(distanceKm: number): string {
  if (distanceKm <= 5) return "Immediate vicinity";
  if (distanceKm <= 10) return "Nearby";
  if (distanceKm <= 25) return "Regional vicinity";
  return "Outside default radius";
}

const provinces: Record<DemoListing["province"], string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", ON: "Ontario",
  PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan",
};

function FacilityCard({ facility }: { facility: DataCenterFacility }) {
  const proximity = facility.distance_km === null
    ? "Distance not verified"
    : `${facility.distance_is_approximate ? "About " : ""}${facility.distance_km.toFixed(1)} km · ${proximityBand(facility.distance_km)}`;

  return (
    <li className="infrastructure-facility-card">
      <div className="infrastructure-facility-topline">
        <strong>{facility.name}</strong>
        <span>{statusLabels[facility.status]}</span>
      </div>
      <p className="infrastructure-facility-meta">
        {facility.company ? `${facility.company} · ` : ""}{proximity}
        {facility.address ? ` · ${facility.address}` : ""}
        {facility.facility_type !== "unknown" ? ` · ${facility.facility_type.replaceAll("_", " ")}` : ""}
      </p>
      <p>{facility.evidence_summary}</p>
      {facility.expected_construction_date || facility.expected_completion_date ? (
        <p className="infrastructure-facility-meta">
          {facility.expected_construction_date ? `Construction: ${facility.expected_construction_date}` : ""}
          {facility.expected_construction_date && facility.expected_completion_date ? " · " : ""}
          {facility.expected_completion_date ? `Expected completion: ${facility.expected_completion_date}` : ""}
        </p>
      ) : null}
      {facility.cooling_and_water_information ? <p>Water/cooling: {facility.cooling_and_water_information}</p> : null}
      {facility.power_information ? <p>Power: {facility.power_information}</p> : null}
      {facility.municipal_approvals.length > 0 ? <p>Approvals: {facility.municipal_approvals.join("; ")}</p> : null}
      <SourceLinks sources={facility.sources} />
    </li>
  );
}

function SourceLinks({ sources }: { sources: FarmScopeAssessment["sources"] }) {
  if (!sources.length) return null;
  return (
    <div className="infrastructure-sources">
      {sources.map((source) => (
        <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
          {source.title}{source.publication_date ? ` · ${source.publication_date}` : ""}
          <ExternalLink aria-hidden="true" size={12} />
        </a>
      ))}
    </div>
  );
}

function Findings({
  title,
  findings,
  emptyMessage,
}: {
  title: string;
  findings: EvidenceFinding[];
  emptyMessage: string;
}) {
  return (
    <section className="infrastructure-assessment-block">
      <h4>{title}</h4>
      {findings.length === 0 && <p className="infrastructure-empty-note">{emptyMessage}</p>}
      <ul className="infrastructure-finding-list">
        {findings.map((item, index) => (
          <li key={`${title}-${index}`}>
            <span>{item.finding}</span>
            {!item.documented && <small>Potential pathway; not a documented impact.</small>}
            <SourceLinks sources={item.sources} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DataCenterSignal({ listing }: DataCenterSignalProps) {
  const province = provinces[listing.province];
  const [attempt, setAttempt] = useState(0);
  const [assessment, setAssessment] = useState<FarmScopeAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAssessment(null);

    void lookupNearbyDataCenters({
      latitude: listing.latitude,
      longitude: listing.longitude,
      radiusKm: 25,
      province,
      country: "Canada",
      farmAddress: null,
      isDemoLocation: true,
    }, controller.signal)
      .then((result) => {
        if (active) setAssessment(result);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to assess nearby development.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; controller.abort(); };
  }, [listing.latitude, listing.longitude, province, attempt]);

  return (
    <section aria-labelledby="data-center-signal-title" className="infrastructure-signal">
      <div className="infrastructure-signal-heading">
        <div>
          <span className="kpi-tile-label">Development exposure</span>
          <h3 id="data-center-signal-title">Data centers and projects</h3>
        </div>
        {loading && <span aria-label="Checking public records and reports" className="infrastructure-loading-dot" role="status" />}
      </div>
      <p className="infrastructure-demo-note">
        Fictional demo parcel: this is an area screening around sample coordinates, not due diligence for a real property.
      </p>
      <p className="infrastructure-result-note">
        Searching around {listing.latitude.toFixed(4)}, {listing.longitude.toFixed(4)} · {province}, Canada · 25 km radius
      </p>

      {loading && <p aria-live="polite" className="infrastructure-result-note" role="status">Checking public and municipal reports within 25 km…</p>}
      {error && <p className="rotation-error" role="alert">{error}</p>}
      {!loading && (error || assessment?.assessment_status === "unavailable") && (
        <button className="crop-add-button" onClick={() => setAttempt((value) => value + 1)} type="button">Retry web search</button>
      )}
      {assessment && (
        <>
          {assessment.assessment_status === "unavailable" && (
            <p aria-live="polite" className="infrastructure-result-note" role="status">
              Live web research is unavailable. Nearby facility presence has not been determined.
            </p>
          )}
          {assessment.assessment_status === "no_reports_found" && (
            <p aria-live="polite" className="infrastructure-result-note" role="status">
              No qualifying reports were found within {assessment.search_radius_km} km in the sources checked. This does not confirm that no facility or proposal exists.
            </p>
          )}
          <div className="farm-exposure-summary">
            <div>
              <span className="kpi-tile-label">Purchasing due diligence</span>
              <strong>{assessment.purchase_recommendation}</strong>
            </div>
            <div>
              <span className="kpi-tile-label">Exposure screening</span>
              <strong>{assessment.exposure_score === null
                ? "Not scored · evidence insufficient"
                : `${assessment.exposure_score}/100 · ${exposureLabel(assessment.exposure_score)}`}</strong>
              <small>Confidence: {assessment.score_confidence}</small>
              {assessment.exposure_score !== null && (
                <div aria-label={`${assessment.exposure_score} out of 100 exposure`} className="exposure-score-track" role="img">
                  <span style={{ width: `${assessment.exposure_score}%` }} />
                </div>
              )}
            </div>
            {assessment.closest_verified_facility_km !== null && (
              <div>
                <span className="kpi-tile-label">Closest verified facility</span>
                <strong>{assessment.closest_verified_facility_km.toFixed(1)} km</strong>
              </div>
            )}
          </div>

          <section className="infrastructure-assessment-block">
            <h4>Exposure factor breakdown</h4>
            <ul className="exposure-factor-list">
              {assessment.exposure_factors.map((factor) => (
                <li key={factor.factor}>
                  <div className="exposure-factor-topline">
                    <strong>{factorLabels[factor.factor] ?? factor.factor}</strong>
                    <span>{factor.score === null ? "Not scored" : `${factor.score}/100 · ${factor.weight_pct}% weight`}</span>
                  </div>
                  <p>{factor.rationale}</p>
                  <SourceLinks sources={factor.sources} />
                </li>
              ))}
            </ul>
          </section>

          <section className="infrastructure-assessment-block">
            <h4>Existing data centers</h4>
            {assessment.existing_data_centers.length === 0 && (
              <p className="infrastructure-empty-note">
                {assessment.assessment_status === "unavailable"
                  ? "Not assessed because online search is unavailable."
                  : "No qualifying operating facilities were identified in the cited results; this is not proof of absence."}
              </p>
            )}
            {assessment.existing_data_centers.length > 0 && (
              <ul className="infrastructure-facility-list">
                {assessment.existing_data_centers.map((facility) => <FacilityCard facility={facility} key={`${facility.name}-${facility.distance_km}`} />)}
              </ul>
            )}
          </section>
          <section className="infrastructure-assessment-block">
            <h4>Planned and developing projects</h4>
            {assessment.planned_data_centers.length === 0 && (
              <p className="infrastructure-empty-note">
                {assessment.assessment_status === "unavailable"
                  ? "Not assessed because online search is unavailable."
                  : "No qualifying development projects were identified in the cited results; this is not proof of absence."}
              </p>
            )}
            {assessment.planned_data_centers.length > 0 && (
              <ul className="infrastructure-facility-list">
                {assessment.planned_data_centers.map((facility) => <FacilityCard facility={facility} key={`${facility.name}-${facility.status}`} />)}
              </ul>
            )}
          </section>

          <Findings
            title="Water resources"
            findings={assessment.water_concerns}
            emptyMessage={assessment.assessment_status === "unavailable" ? "Not assessed because online search is unavailable." : "No cited water-resource findings; water use was not assumed."}
          />
          <Findings
            title="Energy infrastructure"
            findings={assessment.energy_concerns}
            emptyMessage={assessment.assessment_status === "unavailable" ? "Not assessed because online search is unavailable." : "No cited energy-infrastructure findings were identified."}
          />
          <Findings
            title="Land use"
            findings={assessment.land_use_concerns}
            emptyMessage={assessment.assessment_status === "unavailable" ? "Not assessed because online search is unavailable." : "No cited land-use findings were identified."}
          />
          <Findings
            title="Environmental considerations"
            findings={assessment.environmental_concerns}
            emptyMessage={assessment.assessment_status === "unavailable" ? "Not assessed because online search is unavailable." : "No cited environmental-impact findings were identified."}
          />

          {assessment.key_findings.length > 0 && (
            <section className="infrastructure-assessment-block">
              <h4>Key findings</h4>
              <ul className="infrastructure-finding-list">
                {assessment.key_findings.map((item, index) => (
                  <li key={`finding-${index}`}>
                    <span>{item.finding}</span>
                    <SourceLinks sources={item.sources} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {assessment.recommended_due_diligence.length > 0 && (
            <section className="infrastructure-assessment-block">
              <h4>Recommended due diligence</h4>
              <ul className="infrastructure-plain-list">
                {assessment.recommended_due_diligence.map((item, index) => <li key={`diligence-${index}`}>{item}</li>)}
              </ul>
            </section>
          )}
          {assessment.data_gaps.length > 0 && (
            <section className="infrastructure-assessment-block">
              <h4>Information gaps</h4>
              <ul className="infrastructure-plain-list">
                {assessment.data_gaps.map((item, index) => <li key={`gap-${index}`}>{item}</li>)}
              </ul>
            </section>
          )}
          <p className="infrastructure-result-note">
            Assessment {assessment.assessment_date} · {assessment.farm_location.province}, {assessment.farm_location.country} · {assessment.search_radius_km} km radius. Proximity is not proof of impact; this assessment does not determine whether land is suitable or safe to purchase.
          </p>
          <SourceLinks sources={assessment.sources} />
          {assessment.search_suggestions_html?.map((html, index) => (
            <iframe key={index} title={`Google Search suggestions ${index + 1}`} srcDoc={html}
              sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
              style={{ width: "100%", height: 160, border: 0 }} />
          ))}
        </>
      )}
    </section>
  );
}
