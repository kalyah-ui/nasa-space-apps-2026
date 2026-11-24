"use client";

import { useEffect, useState } from "react";
import type { NearbyWells as NearbyWellRecords } from "@/lib/datasets/wells-types";
import type { DemoListing } from "./listings/demo-listings";

const cached = new Map<string, NearbyWellRecords>();
function cachedWells(key: string) {
  const value = cached.get(key);
  return value && Date.now() - Date.parse(value.retrieved_at) < 7 * 24 * 60 * 60_000 ? value : null;
}

export function NearbyWells({ listing }: { listing: DemoListing }) {
  const key = `${listing.latitude},${listing.longitude}`;
  const [data, setData] = useState<NearbyWellRecords | null>(() => cachedWells(key));
  const [loading, setLoading] = useState(() => listing.province === "ON" && !cachedWells(key));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (listing.province !== "ON") { setLoading(false); setData(null); return; }
    const existing = cachedWells(key);
    if (existing) { setData(existing); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    const params = new URLSearchParams({ latitude: String(listing.latitude), longitude: String(listing.longitude) });
    void fetch(`/api/wells?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Well records could not be loaded.");
        if (controller.signal.aborted) return;
        if (cached.size >= 50) cached.delete(cached.keys().next().value!);
        cached.set(key, result as NearbyWellRecords);
        setData(result as NearbyWellRecords);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Well records could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, listing.latitude, listing.longitude, listing.province, attempt]);

  return (
    <section className="infrastructure-signal" aria-labelledby="nearby-wells-title">
      <span className="kpi-tile-label">Groundwater context</span>
      <h3 id="nearby-wells-title">Nearby well records</h3>
      {listing.province !== "ON" ? <p className="infrastructure-result-note">
        Ontario coverage only in this panel. Explore other provinces through <a href="https://gin.geosciences.ca/service/api_ngwds:gin2/en/gin.html" target="_blank" rel="noreferrer">Canada’s Groundwater Information Network</a>.
      </p> : <>
        <p className="infrastructure-demo-note">Ontario WWIS · Within 1 km of this demo location</p>
        {loading && <p className="infrastructure-result-note" role="status">Loading reported well locations…</p>}
        {error && <>
          <p className="rotation-error" role="alert">{error}</p>
          <button className="crop-add-button" onClick={() => setAttempt((value) => value + 1)} type="button">Retry well records</button>
        </>}
        {data && <>
          <div className="farm-exposure-summary">
            <div><span className="kpi-tile-label">Reported records</span><strong>{data.total_records.toLocaleString()}</strong></div>
            {data.records[0] && data.complete && <div><span className="kpi-tile-label">Nearest recorded location</span><strong>About {data.records[0].distance_m} m</strong></div>}
          </div>
          {data.total_records === 0 ? <p className="infrastructure-result-note">No reported records found in this area. Unrecorded wells may exist.</p>
            : data.records.length > 0 ? <details className="infrastructure-assessment-block">
              <summary>{data.complete ? "Nearest records" : "Sample of returned records"}</summary>
              <ul className="infrastructure-facility-list">
                {data.records.map((well) => <li className="infrastructure-facility-card" key={well.id}>
                  <strong>Well record {well.id} · About {well.distance_m} m</strong>
                  <p className="infrastructure-facility-meta">
                    {well.depth_m === null ? "Depth not reported" : `${well.depth_m.toFixed(1)} m deep`}
                    {well.completed_year ? ` · ${well.completed_year}` : ""}
                    {well.recorded_status ? ` · ${well.recorded_status}` : ""}
                    {well.recorded_use ? ` · ${well.recorded_use}` : ""}
                  </p>
                </li>)}
              </ul>
              {!data.complete && <p className="infrastructure-result-note">The service returned a limited sample; these may not be the closest records.</p>}
            </details> : <p className="infrastructure-result-note">Record details could not be located accurately enough to list.</p>}
          <p className="infrastructure-result-note">Reported locations may be approximate. Records do not confirm an active well, water quality, or water access on this parcel.</p>
        </>}
        <p className="infrastructure-result-note"><a href="https://data.ontario.ca/en/dataset/well-records" target="_blank" rel="noreferrer">Ontario Well Records</a> · <a href="https://www.ontario.ca/page/well-records" target="_blank" rel="noreferrer">Official well-records map</a></p>
      </>}
    </section>
  );
}
