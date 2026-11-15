import assert from "node:assert/strict";
import test from "node:test";
import type { CompositeScore } from "../scoring";
import {
  buildCropRotationPlan,
  inferCropFamily,
  rankCropRecommendations,
  recommendCropRotations,
} from "./index";

function suitability(score: number | null, coveragePct = 100): CompositeScore {
  return {
    score,
    coveragePct,
    components: [],
    missingComponents: score === null ? ["climate"] : [],
  };
}

const crops = [
  { id: "corn", name: "Corn", family: "grass", suitability: suitability(80, 90) },
  { id: "soy", name: "Soybean", family: "legume", suitability: suitability(75) },
  { id: "canola", name: "Canola", family: "mustard", suitability: suitability(60) },
  { id: "unknown", name: "Unknown", family: "other", suitability: suitability(null, 0) },
];

test("crop ranking keeps coverage and returns unscored crops separately", () => {
  const result = rankCropRecommendations(crops);

  assert.deepEqual(
    result.recommendations.map(({ cropId, rank }) => [cropId, rank]),
    [["corn", 1], ["soy", 2], ["canola", 3]],
  );
  assert.equal(result.recommendations[0].coveragePct, 90);
  assert.deepEqual(result.unscoredCropIds, ["unknown"]);
});

test("crop recommendations preserve component provenance for explanation", () => {
  const component = {
    key: "soil",
    score: 82,
    weight: 2,
    coveragePct: 90,
    source: "SSURGO",
    sourceDate: "2026-11-01",
  };
  const result = rankCropRecommendations([
    {
      ...crops[0],
      suitability: { ...suitability(82, 90), components: [component] },
    },
  ]);

  assert.deepEqual(result.recommendations[0].components, [component]);
});

test("rotation suggestions avoid consecutive crops from the same family", () => {
  const rotations = recommendCropRotations(crops, 3, 5);

  assert.ok(rotations.length > 0);
  for (const rotation of rotations) {
    const families = rotation.cropIds.map((id) => crops.find((crop) => crop.id === id)?.family);
    for (let index = 1; index < families.length; index += 1) {
      assert.notEqual(families[index], families[index - 1]);
    }
  }
});

test("a rotation cannot be recommended without distinct crop families", () => {
  const sameFamilyCrops = [
    { ...crops[0], family: "grass" },
    { ...crops[0], id: "wheat", name: "Wheat", family: "grass" },
  ];

  assert.deepEqual(recommendCropRotations(sameFamilyCrops, 2), []);
});

test("user-input rotation plan starts with the current crop and alternates families", () => {
  const plan = buildCropRotationPlan(
    { name: "Corn", family: "Cereal / grass" },
    [
      { name: "Soybean", family: "Legume" },
      { name: "Wheat", family: "Cereal / grass" },
      { name: "Canola", family: "Brassica / oilseed" },
    ],
    4,
  );

  assert.ok(plan);
  assert.deepEqual(plan.map((crop) => crop.name), ["Corn", "Soybean", "Wheat", "Canola"]);
  assert.equal(plan[0].isCurrent, true);
  for (let index = 1; index < plan.length; index += 1) {
    assert.notEqual(plan[index].family.toLowerCase(), plan[index - 1].family.toLowerCase());
  }
});

test("user-input rotation plan returns null when crop families cannot alternate", () => {
  const plan = buildCropRotationPlan(
    { name: "Corn", family: "Cereal / grass" },
    [{ name: "Wheat", family: "Cereal / grass" }],
    3,
  );

  assert.equal(plan, null);
});

test("user-input rotation plan rejects missing crop names or families", () => {
  assert.throws(
    () => buildCropRotationPlan({ name: "", family: "Cereal / grass" }, [], 3),
    RangeError,
  );
  assert.throws(
    () => buildCropRotationPlan(
      { name: "Corn", family: "Cereal / grass" },
      [{ name: "Soybean", family: "" }],
      3,
    ),
    RangeError,
  );
});

test("recognized crop names and common aliases infer their botanical family", () => {
  assert.equal(inferCropFamily("Corn"), "Poaceae");
  assert.equal(inferCropFamily("  MAIZE  "), "Poaceae");
  assert.equal(inferCropFamily("Soybean"), "Fabaceae");
  assert.equal(inferCropFamily("Canola"), "Brassicaceae");
});

test("plural crop names infer the family of their singular crop name", () => {
  assert.equal(inferCropFamily("strawberries"), "Rosaceae");
  assert.equal(inferCropFamily("tomatoes"), "Solanaceae");
  assert.equal(inferCropFamily("potatoes"), "Solanaceae");
  assert.equal(inferCropFamily("dry beans"), "Fabaceae");
});

test("unrecognized crop names require the user to select a family", () => {
  assert.equal(inferCropFamily("Specialty crop"), null);
});
