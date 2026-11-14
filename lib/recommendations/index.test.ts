import assert from "node:assert/strict";
import test from "node:test";
import type { CompositeScore } from "../scoring";
import { rankCropRecommendations, recommendCropRotations } from "./index";

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
