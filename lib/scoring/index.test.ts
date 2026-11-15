import assert from "node:assert/strict";
import test from "node:test";
import { calculateFarmScore, calculateWeightedScore } from "./index";

test("weighted scores omit missing values but report their expected weight as uncovered", () => {
  const result = calculateWeightedScore([
    { key: "soil", score: 80, weight: 2 },
    { key: "water", score: null, weight: 1, coveragePct: 100 },
    { key: "flood", score: 40, weight: 1, coveragePct: 50 },
  ]);

  assert.equal(result.score, 66.7);
  assert.equal(result.coveragePct, 62.5);
  assert.deepEqual(result.missingComponents, ["water"]);
});

test("all-missing components produce no score rather than a zero score", () => {
  const result = calculateWeightedScore([
    { key: "soil", score: null, weight: 1 },
    { key: "water", score: null, weight: 1 },
  ]);

  assert.equal(result.score, null);
  assert.equal(result.coveragePct, 0);
});

test("farm scores require normalized inputs and use explicit weights", () => {
  const result = calculateFarmScore({
    soil: { score: 80, weight: 2, source: "SSURGO", sourceDate: "2026-11-01" },
    water: { score: 60, weight: 1 },
    flood: { score: 90, weight: 1 },
    climate: { score: 70, weight: 2 },
  });

  assert.equal(result.score, 75);
  assert.equal(result.components[0].source, "SSURGO");
  assert.equal(result.components[0].sourceDate, "2026-11-01");
});

test("invalid component scores are rejected", () => {
  assert.throws(
    () => calculateWeightedScore([{ key: "soil", score: 101, weight: 1 }]),
    RangeError,
  );
});
