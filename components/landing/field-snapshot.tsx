"use client";

import { useEffect, useState } from "react";
import { SourceErrorRow, formatNumber, useWeatherData, type SourceState } from "@/components/discovery/weather-support";
import { KpiTile } from "@/components/ui/kpi-tile";
import {
  getTerrainSample,
  loadOttawaLandsatSceneField,
  type TerrainSample,
} from "@/lib/datasets/terrain-client";
import { summarizeFieldSoil } from "@/lib/recommendations/field-fit";
import {
  averageTemperature,
  daysToNextFrost,
  estimateFormulas,
  rainfallTotal,
} from "@/lib/weather/derived";
import { weatherProvider } from "@/lib/weather/live-provider";
import type { DailyHistory, Forecast } from "@/lib/weather/types";

const ottawaValleyCenter = { latitude: 45.3083, longitude: -76.2925 };

/**
 * The weather strip uses live regional data at the center of the Ottawa Landsat scene.
 */
export function FieldSnapshot() {
  return (
    <FieldSnapshotInner
      latitude={ottawaValleyCenter.latitude}
      longitude={ottawaValleyCenter.longitude}
    />
  );
}

function FieldSnapshotInner({ latitude, longitude }: { latitude: number; longitude: number }) {
  // 60 days so the 30-reported-day aggregates have margin for gaps.
  const [history, retryHistory] = useWeatherData<DailyHistory>("landing-snapshot", () =>
    weatherProvider.getDailyHistory(latitude, longitude, 60),
  );
  const [forecast, retryForecast] = useWeatherData<Forecast>("landing-snapshot", () =>
    weatherProvider.getForecast(latitude, longitude),
  );

  const historyDays = history.data?.days ?? [];
  const rain30 = history.status === "ready" ? rainfallTotal(historyDays) : null;
  const temp30 = history.status === "ready" ? averageTemperature(historyDays) : null;
  const frostIn =
    forecast.status === "ready" && forecast.data ? daysToNextFrost(forecast.data.days) : undefined;
  const soilMoisture =
    forecast.status === "ready" ? (forecast.data?.days[0]?.soilMoisture ?? null) : null;

  return (
    <>
      <section aria-labelledby="landing-snapshot-title" className="landing-section">
        <div className="landing-section-header">
          <h2 className="landing-section-title" id="landing-snapshot-title">
            Ottawa Valley weather
          </h2>
          <p className="landing-section-note">
            Live regional data from NASA POWER and Open-Meteo
          </p>
        </div>

        {history.status === "error" ? (
          <SourceErrorRow message={history.error} onRetry={retryHistory} sourceLabel="NASA POWER history" />
        ) : null}
        {forecast.status === "error" ? (
          <SourceErrorRow message={forecast.error} onRetry={retryForecast} sourceLabel="Open-Meteo forecast" />
        ) : null}

        <div className="kpi-grid">
          <KpiTile
            label="30-day rain"
            loading={history.status === "loading"}
            note="NASA POWER"
            unit="mm"
            value={rain30 !== null ? formatNumber(rain30) : null}
          />
          <KpiTile
            label="Avg temp (30d)"
            loading={history.status === "loading"}
            note="NASA POWER"
            unit="°C"
            value={temp30 !== null ? formatNumber(temp30, 1) : null}
          />
          <KpiTile
            label="Soil moisture"
            loading={forecast.status === "loading"}
            note="3–9 cm, Open-Meteo"
            unit="vol %"
            value={soilMoisture !== null ? formatNumber(soilMoisture * 100) : null}
          />
          <KpiTile
            estimateTitle={estimateFormulas.daysToNextFrost}
            label="Frost risk"
            loading={forecast.status === "loading"}
            note={frostIn === null ? "none in 7-day window" : "first day with Tmin ≤ 2°C"}
            unit={frostIn === null ? undefined : "days"}
            value={frostIn === undefined ? null : frostIn === null ? "7+" : `${frostIn}`}
          />
        </div>
      </section>
      <OttawaGcsRegionContext />
    </>
  );
}

function OttawaGcsRegionContext() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SourceState<TerrainSample>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });

    async function loadContext() {
      const field = await loadOttawaLandsatSceneField(controller.signal);
      const sample = await getTerrainSample(field, controller.signal);
      if (active) {
        setState({ status: "ready", data: sample });
      }
    }

    void loadContext().catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Unexpected error.",
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const sample = state.data;
  const soil = sample ? summarizeFieldSoil(sample.soil_landscapes) : null;
  const soilAvailable = sample?.sources.some(
    (source) => source.source_id === "soil" && source.status === "extracted",
  ) ?? false;
  const extractedSources = sample?.sources
    .filter((source) => source.status === "extracted")
    .map((source) => source.label)
    .join(" · ");

  return (
    <section aria-labelledby="landing-gcs-title" className="landing-section">
      <div className="landing-section-header">
        <h2 className="landing-section-title" id="landing-gcs-title">
          Ottawa Valley observations from GCS
        </h2>
        <p className="landing-section-note">
          Real datasets sampled over the Landsat scene footprint; regional measurements, not parcel data
        </p>
      </div>

      {state.status === "error" ? (
        <SourceErrorRow
          message={state.error}
          onRetry={() => setAttempt((current) => current + 1)}
          sourceLabel="GCS regional data"
        />
      ) : null}

      <div className="kpi-grid">
        <KpiTile
          label="Mean elevation"
          loading={state.status === "loading"}
          note="SRTM · Landsat scene footprint"
          unit="m"
          value={sample ? formatNumber(sample.mean_elevation_m, 1) : null}
        />
        <KpiTile
          label="Mean slope"
          loading={state.status === "loading"}
          note="SRTM"
          unit={sample?.mean_slope_degrees === null ? undefined : "°"}
          value={
            sample?.mean_slope_degrees === null || sample?.mean_slope_degrees === undefined
              ? null
              : formatNumber(sample.mean_slope_degrees, 2)
          }
        />
        <KpiTile
          label="Soil map coverage"
          loading={state.status === "loading"}
          note="CanSIS regional map"
          unit="%"
          value={soil && soilAvailable ? formatNumber(soil.coveragePct) : null}
        />
        <KpiTile
          label="Mapped surface pH"
          loading={state.status === "loading"}
          note="CanSIS · CaCl₂"
          value={soil && soilAvailable && soil.phCacl2 !== null ? formatNumber(soil.phCacl2, 1) : null}
        />
        <KpiTile
          label="Mean NDVI"
          loading={state.status === "loading"}
          note={
            sample?.landsat_observation
              ? `Landsat 8 · ${sample.landsat_observation.acquired_at.slice(0, 10)} · ${formatNumber(sample.landsat_observation.clear_pixel_count)} clear pixels`
              : "Landsat 8 · cloud-masked"
          }
          value={
            sample?.landsat_observation
              ? formatNumber(sample.landsat_observation.mean_ndvi, 3)
              : null
          }
        />
      </div>

      {sample ? (
        <>
          {sample.sources
            .filter((source) => source.status !== "extracted")
            .map((source) => (
              <p className="source-error" key={source.source_id} role="status">
                {source.label} unavailable: {source.detail}
              </p>
            ))}
          {soil &&
          soilAvailable &&
          soil.sandPct !== null &&
          soil.siltPct !== null &&
          soil.clayPct !== null ? (
            <p className="landing-section-note">
              CanSIS mapped texture (sand / silt / clay): {formatNumber(soil.sandPct, 1)}% /{" "}
              {formatNumber(soil.siltPct, 1)}% / {formatNumber(soil.clayPct, 1)}%.
            </p>
          ) : null}
          {sample.crop_class_counts.length > 0 ? (
            <p className="landing-section-note">
              2025 Ontario crop inventory
              {sample.crop_class_counts.some((item) => !item.label)
                ? " (unmatched classes shown by code)"
                : ""}
              :{" "}
              {sample.crop_class_counts
                .map(
                  (item) =>
                    `${item.label ?? `Class ${item.class_code}`}: ${formatNumber(item.field_share_pct, 1)}%`,
                )
                .join(" · ")}.
            </p>
          ) : null}
          {sample.flood_map_studies.length > 0 ? (
            <p className="landing-section-note">
              Flood-map inventory:{" "}
              {sample.flood_map_studies
                .map(
                  (study) =>
                    `${study.study_name}${study.study_date ? ` (${study.study_date.slice(0, 4)})` : ""} — ${study.availability_status ?? "availability unknown"}`,
                )
                .join(" · ")}. Inventory coverage only; this is not a flood-hazard assessment.
            </p>
          ) : null}
          <p className="landing-section-note">
            GCS sources: {extractedSources || "none extracted"}. CanSIS is 1:1,000,000 regional
            screening, not a soil test. NDVI is one satellite observation, not a crop-health
            diagnosis.
          </p>
        </>
      ) : state.status === "loading" ? (
        <p className="landing-section-note">Loading Ottawa-area GCS datasets…</p>
      ) : null}
    </section>
  );
}
