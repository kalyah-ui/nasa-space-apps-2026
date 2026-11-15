import type { TerrainSample } from "@/lib/datasets/terrain-client";
import type { FieldSoilContext } from "@/lib/recommendations/field-fit";

export function FieldInsights({ sample, fieldSoil }: { sample: TerrainSample; fieldSoil: FieldSoilContext }) {
  const cropClassPresent = sample.crop_sample_count > 0;

  return (
    <div className="farmer-insights">
      <section aria-labelledby="field-conditions-title" className="rotation-section">
        <p className="eyebrow">Field conditions</p>
        <h2 id="field-conditions-title">{sample.field_name}</h2>
        <p className="rotation-provenance">
          Screening information for this boundary. Soil landscape data is regional context, not a substitute for a field soil test.
        </p>
        <dl className="farmer-condition-grid">
          <div>
            <dt>Mean elevation</dt>
            <dd>{sample.mean_elevation_m.toLocaleString()} m</dd>
          </div>
          <div>
            <dt>Mean slope</dt>
            <dd>{sample.mean_slope_degrees === null ? "Not available" : `${sample.mean_slope_degrees.toFixed(2)}°`}</dd>
          </div>
          <div>
            <dt>Soil map coverage</dt>
            <dd>{fieldSoil.coveragePct.toFixed(0)}%</dd>
          </div>
          <div>
            <dt>Crop type</dt>
            <dd>{cropClassPresent ? "Needs confirmation" : "Not identified"}</dd>
          </div>
        </dl>
        {cropClassPresent && (
          <p className="rotation-provenance">
            A crop-cover record is present, but the crop name has not been confirmed for this field.
          </p>
        )}
      </section>

      <section aria-labelledby="soil-profile-title" className="rotation-section">
        <p className="eyebrow">Landscape soil estimate</p>
        <h2 id="soil-profile-title">Surface soil profile</h2>
        {fieldSoil.sandPct === null || fieldSoil.siltPct === null || fieldSoil.clayPct === null ? (
          <p className="rotation-provenance">Surface texture values are not available for this field.</p>
        ) : (
          <>
            <div aria-label="Estimated sand, silt, and clay composition" className="soil-texture-bar" role="img">
              <span className="soil-texture-sand" style={{ width: `${fieldSoil.sandPct}%` }} />
              <span className="soil-texture-silt" style={{ width: `${fieldSoil.siltPct}%` }} />
              <span className="soil-texture-clay" style={{ width: `${fieldSoil.clayPct}%` }} />
            </div>
            <dl className="soil-texture-legend">
              <div><dt><i className="soil-swatch soil-swatch-sand" />Sand</dt><dd>{fieldSoil.sandPct.toFixed(0)}%</dd></div>
              <div><dt><i className="soil-swatch soil-swatch-silt" />Silt</dt><dd>{fieldSoil.siltPct.toFixed(0)}%</dd></div>
              <div><dt><i className="soil-swatch soil-swatch-clay" />Clay</dt><dd>{fieldSoil.clayPct.toFixed(0)}%</dd></div>
            </dl>
          </>
        )}
        <dl className="farmer-condition-grid farmer-condition-grid--compact">
          <div>
            <dt>Soil pH (CaCl2)</dt>
            <dd>{fieldSoil.phCacl2 === null ? "Not available" : fieldSoil.phCacl2.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Texture data coverage</dt>
            <dd>{fieldSoil.coveragePct.toFixed(0)}%</dd>
          </div>
        </dl>
      </section>

    </div>
  );
}
