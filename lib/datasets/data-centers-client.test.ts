import assert from "node:assert/strict";
import test from "node:test";
import { clearCachedNearbyAnalysis, getCachedNearbyDataCenters, lookupNearbyDataCenters, type FarmScopeAssessment } from "./data-centers-client";

const sample = (status = "no_reports_found", searchedAt = new Date().toISOString()) => ({
  provider: "tavily", assessment_status: status, searched_at: searchedAt,
}) as FarmScopeAssessment;

test("revisiting a location reuses the browser report without another API call", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(sample()); });
  const input = { latitude: 43.11, longitude: -81.4 };
  const first = await lookupNearbyDataCenters(input);
  assert.equal(getCachedNearbyDataCenters(input), first);
  assert.equal(await lookupNearbyDataCenters(input), first);
  assert.equal(calls, 1);
});

test("concurrent card mounts share one request, even when one caller unmounts", async (context) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  context.mock.method(globalThis, "fetch", async () => { calls++; await gate; return Response.json(sample()); });
  const input = { latitude: 43.12, longitude: -81.4 };
  const controller = new AbortController();
  const first = lookupNearbyDataCenters(input, controller.signal);
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = lookupNearbyDataCenters(input);
  controller.abort();
  release();
  await rejected;
  await second;
  assert.ok(getCachedNearbyDataCenters(input));
  assert.equal(calls, 1);
});

test("radius changes use a different cache entry and failures remain retryable", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json(sample());
  });
  const input = { latitude: 43.13, longitude: -81.4 };
  await assert.rejects(lookupNearbyDataCenters(input), /Unavailable/);
  await lookupNearbyDataCenters(input);
  await lookupNearbyDataCenters({ ...input, radiusKm: 20 });
  assert.equal(calls, 3);
});

test("complete reports expire after seven days while incomplete analysis recovers after five minutes", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(sample(calls === 1 ? "sources_only" : "no_reports_found", new Date(now).toISOString())); });
  const input = { latitude: 43.14, longitude: -81.4 };
  await lookupNearbyDataCenters(input);
  await lookupNearbyDataCenters(input);
  assert.equal(calls, 1);
  now += 5 * 60_000 + 1;
  await lookupNearbyDataCenters(input);
  assert.equal(calls, 2);
  now += 6 * 24 * 60 * 60_000;
  await lookupNearbyDataCenters(input);
  assert.equal(calls, 2);
  now += 24 * 60 * 60_000 + 1;
  await lookupNearbyDataCenters(input);
  assert.equal(calls, 3);
});


test("manual analysis retry clears incomplete browser results but preserves completed ones", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(sample(calls === 1 ? "sources_only" : "no_reports_found")); });
  const input = { latitude: 43.15, longitude: -81.4 };
  await lookupNearbyDataCenters(input);
  clearCachedNearbyAnalysis(input);
  await lookupNearbyDataCenters(input);
  clearCachedNearbyAnalysis(input);
  await lookupNearbyDataCenters(input);
  assert.equal(calls, 2);
});
