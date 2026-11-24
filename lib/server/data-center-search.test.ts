import assert from "node:assert/strict";
import test from "node:test";
import { parseGroundedAssessment, parseSearchLocation, searchDataCenters } from "./data-center-search";

const location = parseSearchLocation({ latitude: 45.307, longitude: -76.298, province: "Ontario", is_demo_location: true });
const url = "https://example.com/planning-record";
const facility = { name: "Example campus", status: "approved", latitude: 45.32, longitude: -76.3, source_urls: [url] };
function payload(facilities: unknown[] = [], search = true) {
  return { steps: [
    ...(search ? [{ type: "google_search_call" }] : []),
    { type: "model_output", content: [{ text: JSON.stringify({ existing_data_centers: [], planned_data_centers: facilities }),
      annotations: [{ type: "url_citation", url, title: "Planning record" }] }] },
  ] };
}

test("validates coordinates and radius without treating demo coordinates as fake locations", () => {
  assert.equal(location.is_demo_location, true);
  assert.equal(location.radius_km, 25);
  for (const input of [{ latitude: 91, longitude: 0 }, { latitude: "45", longitude: 0 }, { latitude: 45, longitude: 0, radius_km: 101 }]) {
    assert.throws(() => parseSearchLocation(input));
  }
});

test("keeps cited nearby proposals, computes distances, and separates operating facilities", () => {
  const result = parseGroundedAssessment(payload([facility, { ...facility, name: "Operating", status: "operational" }]), location);
  assert.equal(result.planned_data_centers[0].status, "approved");
  assert.equal(result.existing_data_centers.length, 1);
  assert.ok(result.closest_verified_facility_km! > 1 && result.closest_verified_facility_km! < 2);
  assert.equal(result.planned_data_centers[0].sources[0].url, url);
  assert.equal(result.exposure_score, null);
});

test("excludes far and uncited facilities and never turns empty research into a zero risk score", () => {
  const result = parseGroundedAssessment(payload([{ ...facility, latitude: 50 }, { ...facility, source_urls: ["https://invented.example"] }]), location);
  assert.equal(result.planned_data_centers.length, 0);
  assert.equal(result.assessment_status, "no_reports_found");
  assert.equal(result.exposure_score, null);
  assert.match(result.data_gaps.join(" "), /does not confirm/);
});

test("unknown coordinates remain unverified, never a fabricated distance", () => {
  const result = parseGroundedAssessment(payload([{ ...facility, latitude: null, longitude: null }]), location);
  assert.equal(result.planned_data_centers[0].distance_km, null);
  assert.match(result.data_gaps.join(" "), /distance.*unverified/);
});

test("rejects responses that did not search or omit the expected report lists", () => {
  assert.throws(() => parseGroundedAssessment(payload([], false), location), /did not perform/);
  assert.throws(() => parseGroundedAssessment({ steps: [{ type: "google_search_call" }, { type: "model_output", content: [{ text: "{}" }] }] }, location), /incomplete/);
});

test("sends coordinates with the Google Search tool and server-only API header", async () => {
  const fakeFetch: typeof fetch = async (endpoint, options) => {
    assert.equal(endpoint, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal((options!.headers as Record<string, string>)["x-goog-api-key"], "test-key");
    const request = JSON.parse(options!.body as string);
    assert.deepEqual(request.tools, [{ type: "google_search" }]);
    assert.match(request.input, /45\.307/);
    assert.match(request.input, /-76\.298/);
    assert.equal(request.store, false);
    return Response.json(payload([facility]));
  };
  const result = await searchDataCenters(location, "test-key", "gemini-3.8-flash", fakeFetch);
  assert.equal(result.provider, "gemini-google-search");
});

test("API failures remain retryable errors instead of no-results assessments", async () => {
  await assert.rejects(searchDataCenters(location, "test-key", "test-model", async () => new Response("quota", { status: 429 })), /quota/);
});
