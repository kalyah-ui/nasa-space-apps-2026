import assert from "node:assert/strict";
import test from "node:test";
import { screenCropFieldFit, summarizeFieldSoil } from "./field-fit";

const soilLandscapes = [
  {
    field_overlap_pct: 100,
    components: [
      {
        composition_pct: 60,
        surface_horizon: { sand_pct: 40, silt_pct: 35, clay_pct: 25, ph_cacl2: 6.2 },
      },
      {
        composition_pct: 40,
        surface_horizon: { sand_pct: 60, silt_pct: 25, clay_pct: 15, ph_cacl2: 5.8 },
      },
    ],
  },
];

test("field soil summary is weighted by mapped landscape composition", () => {
  const summary = summarizeFieldSoil(soilLandscapes);

  assert.equal(summary.sandPct, 48);
  assert.equal(summary.siltPct, 31);
  assert.equal(summary.clayPct, 21);
  assert.equal(summary.phCacl2, 6.04);
  assert.equal(summary.coveragePct, 100);
});

test("known crops receive a transparent pH and texture screen", () => {
  const summary = summarizeFieldSoil(soilLandscapes);
  const fit = screenCropFieldFit("Soybeans", summary);

  assert.equal(fit.score, 100);
  assert.equal(fit.verdict, "Good soil match");
  assert.equal(fit.coveragePct, 100);
});

test("unsupported crops are left unrated instead of receiving an invented fit score", () => {
  const fit = screenCropFieldFit("Specialty crop", summarizeFieldSoil(soilLandscapes));

  assert.equal(fit.score, null);
  assert.equal(fit.verdict, "Not rated");
});

test("missing soil inputs produce a not-rated crop screen", () => {
  const fit = screenCropFieldFit("Corn", {
    sandPct: null,
    siltPct: null,
    clayPct: null,
    phCacl2: null,
    coveragePct: 0,
  });

  assert.equal(fit.score, null);
  assert.equal(fit.coveragePct, 0);
});
