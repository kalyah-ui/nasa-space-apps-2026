import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTerrainSample } from "./terrain-client";

test("older terrain responses without flood studies render with empty optional lists", () => {
  const sample = normalizeTerrainSample({ soil_landscapes: [], sources: [] });
  assert.equal(sample.flood_map_studies.length, 0);
  assert.equal(sample.crop_class_counts.length, 0);
});

test("preserves observations supplied by the backend", () => {
  const studies = [{ study_name: "Ottawa flood study" }];
  const crops = [{ class_code: 1, pixel_count: 2, field_share_pct: 100 }];
  const sample = normalizeTerrainSample({
    soil_landscapes: [], sources: [], flood_map_studies: studies, crop_class_counts: crops,
  });
  assert.deepEqual(sample.flood_map_studies, studies);
  assert.deepEqual(sample.crop_class_counts, crops);
});

test("rejects malformed lists and error payloads before component rendering", () => {
  for (const payload of [null, { detail: "Unavailable" }, { soil_landscapes: [] },
    { soil_landscapes: [], sources: [], flood_map_studies: {} },
    { soil_landscapes: [], sources: [], crop_class_counts: "invalid" }]) {
    assert.throws(() => normalizeTerrainSample(payload), /terrain service returned an invalid/);
  }
});
