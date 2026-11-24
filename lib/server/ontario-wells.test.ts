import assert from "node:assert/strict";
import test from "node:test";
import { fetchOntarioWells, parseWellLocation, parseWellRecords } from "./ontario-wells";

const feature = (id: string, lat: number, depth: unknown = 30) => ({
  attributes: { WELL_ID: id, DEPTH_M: depth, COMPLETED_YEAR: 2001, FINAL_STATUS_DESCR: "Water Supply", USE1: " " },
  geometry: { x: -81.4, y: lat },
});

test("validates location inputs without silently treating absent coordinates as zero", () => {
  assert.deepEqual(parseWellLocation("43.55", "-81.4"), { latitude: 43.55, longitude: -81.4 });
  for (const [lat, lon] of [[null, "0"], ["", "0"], ["91", "0"], ["43", "NaN"], ["43", "181"]]) assert.throws(() => parseWellLocation(lat, lon));
});

test("sorts real nearby records by distance and excludes out-of-radius or missing locations", () => {
  const result = parseWellRecords({ features: [feature("far", 43.8), feature("second", 43.555), feature("nearest", 43.551), { attributes: { WELL_ID: "missing" } }] }, 43.55, -81.4);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].id, "nearest");
  assert.ok(result.records[0].distance_m > 100 && result.records[0].distance_m < 120);
  assert.equal(result.records[0].depth_m, 30);
  assert.equal(result.records[0].recorded_use, null);
});

test("missing/negative depth stays unknown rather than a fabricated zero", () => {
  const result = parseWellRecords({ features: [feature("negative", 43.55, -999), feature("missing", 43.551, null), feature("zero", 43.552, 0)] }, 43.55, -81.4);
  assert.equal(result.records[0].depth_m, null);
  assert.equal(result.records[1].depth_m, null);
  assert.equal(result.records[2].depth_m, 0);
});

test("limited results are flagged so the UI cannot claim to have the nearest well", () => {
  const result = parseWellRecords({ features: [feature("record", 43.55)], exceededTransferLimit: true }, 43.55, -81.4);
  assert.equal(result.complete, false);
});

test("queries the official service for a 1 km circle and returns the total count separately from the sample", async () => {
  let calls = 0;
  const result = await fetchOntarioWells(43.55, -81.4, async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "ws.lioservices.lrc.gov.on.ca");
    assert.equal(url.searchParams.get("geometry"), "-81.4,43.55");
    assert.equal(url.searchParams.get("distance"), "1000");
    assert.equal(url.searchParams.get("units"), "esriSRUnit_Meter");
    assert.equal(url.searchParams.get("inSR"), "4326");
    return url.searchParams.get("returnCountOnly") ? Response.json({ count: 12 }) : Response.json({ features: [feature("record", 43.55)] });
  });
  assert.equal(calls, 2);
  assert.equal(result.total_records, 12);
  assert.equal(result.records.length, 1);
});

test("upstream errors and malformed payloads cannot become zero-record results", async () => {
  assert.throws(() => parseWellRecords({ error: { message: "unavailable" } }, 43.55, -81.4));
  assert.throws(() => parseWellRecords({}, 43.55, -81.4));
  await assert.rejects(fetchOntarioWells(43.55, -81.4, async () => Response.json({ error: { message: "unavailable" } })), /unavailable/);
  await assert.rejects(fetchOntarioWells(43.55, -81.4, async () => Response.json({ features: [] })), /count/);
});
