import assert from "node:assert/strict";
import test from "node:test";
import { WebSearchError, parseTavilyAssessment, parseSearchLocation, searchDataCenters, summarizeDataCenterEvidence } from "./data-center-search";

const location = parseSearchLocation({ latitude: 45.307, longitude: -76.298, province: "Ontario", is_demo_location: true });
const url = "https://example.com/planning-record";
const evidence = [{ url, title: "Planning record", publication_date: "2026-09-01", content: "Example campus and Operating approved at latitude 45.32, longitude -76.3. Noise review required for Example campus." }];
const facility = { name: "Example campus", status: "approved", latitude: 45.32, longitude: -76.3, source_urls: [url] };
const report = (facilities: unknown[] = [facility]) => ({ existing_data_centers: [], planned_data_centers: facilities });
const searchResponse = () => Response.json({ results: evidence });
const summaryResponse = (value: unknown = report()) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });

test("validates coordinates and radius", () => {
  assert.equal(location.is_demo_location, true);
  assert.equal(location.radius_km, 10);
  for (const input of [{ latitude: 91, longitude: 0 }, { latitude: "45", longitude: 0 }, { latitude: 45, longitude: 0, radius_km: 101 }]) assert.throws(() => parseSearchLocation(input));
});

test("keeps cited facilities, separates operating and planned, and computes distances", () => {
  const result = parseTavilyAssessment(report([facility, { ...facility, name: "Operating", status: "operational" }]), evidence, location);
  assert.equal(result.provider, "tavily");
  assert.equal(result.planned_data_centers[0].status, "approved");
  assert.equal(result.existing_data_centers.length, 1);
  assert.ok(result.closest_verified_facility_km! > 1 && result.closest_verified_facility_km! < 2);
  assert.equal(result.sources[0].publication_date, "2026-09-01");
  assert.equal(result.exposure_score, null);
});

test("excludes distant and uncited facilities, and never turns no results into zero risk", () => {
  const result = parseTavilyAssessment(report([{ ...facility, latitude: 50 }, { ...facility, source_urls: ["https://invented.example"] }]), evidence, location);
  assert.equal(result.planned_data_centers.length, 0);
  assert.equal(result.assessment_status, "no_reports_found");
  assert.equal(result.exposure_score, null);
  assert.match(result.data_gaps.join(" "), /not proof of absence/);
});

test("unknown coordinates remain unverified", () => {
  const result = parseTavilyAssessment(report([{ ...facility, latitude: null, longitude: null }]), evidence, location);
  assert.equal(result.planned_data_centers.length, 0);
  assert.equal(result.closest_verified_facility_km, null);
  assert.match(result.data_gaps.join(" "), /not proof of absence/);
  assert.throws(() => parseTavilyAssessment({}, evidence, location), /incomplete/);
});

test("searches Tavily once at basic depth then summarizes with a normal Gemini request without tools", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (endpoint, options) => {
    calls.push(String(endpoint));
    const request = JSON.parse(options!.body as string);
    const headers = options!.headers as Record<string, string>;
    if (calls.length === 1) {
      assert.equal(endpoint, "https://api.tavily.com/search");
      assert.equal(headers.Authorization, "Bearer tavily-test-key");
      assert.equal(headers["x-goog-api-key"], undefined);
      assert.equal(request.search_depth, "basic");
      assert.equal(request.auto_parameters, false);
      assert.equal(request.include_answer, false);
      assert.match(request.query, /45\.307/);
      return searchResponse();
    }
    assert.equal(endpoint, "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent");
    assert.equal(headers["x-goog-api-key"], "gemini-test-key");
    assert.equal(headers.Authorization, undefined);
    assert.equal(request.tools, undefined);
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    assert.match(request.contents[0].parts[0].text, /Planning record/);
    return summaryResponse();
  };
  const result = await searchDataCenters(location, "tavily-test-key", "gemini-test-key", "test-model", fakeFetch);
  assert.equal(calls.length, 2);
  assert.equal(result.provider, "tavily");
  assert.equal(result.planned_data_centers.length, 1);
});

test("empty Tavily results skip Gemini and retain an explicit data gap", async () => {
  let calls = 0;
  const result = await searchDataCenters(location, "tavily", "gemini", "test", async () => { calls++; return Response.json({ results: [] }); });
  assert.equal(calls, 1);
  assert.equal(result.assessment_status, "no_reports_found");
  assert.equal(result.exposure_score, null);
});

test("rejects malformed search responses instead of reporting no facilities", async () => {
  for (const value of [{}, { results: [{ url: "javascript:alert(1)", content: "campus" }] }]) {
    await assert.rejects(searchDataCenters(location, "tavily", "gemini", "test", async () => Response.json(value)), /search provider/);
  }
});

test("ignores unsupported coordinates and scores invented by the summarizer", async () => {
  let calls = 0;
  const result = await searchDataCenters(location, "tavily", "gemini", "test", async () => ++calls === 1
    ? Response.json({ results: [{ ...evidence[0], content: "A campus was proposed. Exact coordinates were not published." }] })
    : summaryResponse({ ...report(), exposure_factors: [{ factor: "existing_facility_proximity", score: 0, source_urls: [url] }] }));
  assert.equal(result.planned_data_centers.length, 0);
  assert.equal(result.closest_verified_facility_km, null);
  assert.equal(result.exposure_score, null);
});

test("Tavily quota errors remain errors, retain safe diagnostics, and never call Gemini", async () => {
  let calls = 0;
  await assert.rejects(searchDataCenters(location, "tavily-test-key", "gemini-test-key", "test", async () => {
    calls++;
    return Response.json({ detail: { error: "Limit exceeded for tavily-test-key" } }, { status: 432 });
  }), (error: unknown) => {
    assert.ok(error instanceof WebSearchError);
    assert.equal(error.status, 432);
    assert.equal(error.provider, "tavily");
    assert.equal(error.providerMessage, "Limit exceeded for [redacted]");
    assert.doesNotMatch(error.message, /test-key/);
    return true;
  });
  assert.equal(calls, 1);
});

test("Gemini summary failure reports unverified coverage without claiming no facilities", async () => {
  let calls = 0;
  const result = await searchDataCenters(location, "tavily", "gemini", "test", async () => ++calls === 1
    ? searchResponse() : Response.json({ error: { message: "Summary quota" } }, { status: 429 }));
  assert.equal(result.assessment_status, "sources_only");
  assert.equal(result.summary_status, "unavailable");
  assert.equal(result.sources.length, 0);
  assert.equal(result.exposure_score, null);
});

test("Tavily works without a Gemini key", async () => {
  let calls = 0;
  const result = await searchDataCenters(location, "tavily", "", "test", async () => { calls++; return searchResponse(); });
  assert.equal(calls, 1);
  assert.equal(result.assessment_status, "sources_only");
  assert.equal(result.key_findings.length, 0);
  assert.equal(result.summary_status, "not_configured");
});

test("invalid or truncated summaries retain sources without fabricating an assessment", async () => {
  for (const candidate of [{ finishReason: "MAX_TOKENS" }, { content: { parts: [{ text: "not json" }] } }]) {
    let calls = 0;
    const result = await searchDataCenters(location, "tavily", "gemini", "test", async () => ++calls === 1
      ? searchResponse() : Response.json({ candidates: [candidate] }));
    assert.equal(result.assessment_status, "sources_only");
    assert.equal(result.planned_data_centers.length, 0);
  }
});


test("province-wide policy cannot become a local concern without a nearby facility", () => {
  const result = parseTavilyAssessment({ ...report([]),
    energy_concerns: [{ finding: "Ontario proposes a provincial electricity rate class", documented: true, source_urls: [url] }],
    key_findings: [{ finding: "Provincial playbook", source_urls: [url] }],
  }, evidence, location);
  assert.equal(result.assessment_status, "no_reports_found");
  assert.deepEqual(result.energy_concerns, []);
  assert.deepEqual(result.key_findings, []);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.exposure_factors, []);
});

test("only documented considerations for a retained facility with exact source evidence survive", () => {
  const result = parseTavilyAssessment({ ...report(), water_concerns: [
    { facility_name: "Example campus", finding: "A noise review was requested for this project.", documented: true,
      evidence_quote: "Noise review required for Example campus.", source_urls: [url] },
    { facility_name: "Some other campus", finding: "Province-wide concerns", documented: true, evidence_quote: "Example", source_urls: [url] },
    { facility_name: "Example campus", finding: "Invented water risk", documented: true, evidence_quote: "not present in source", source_urls: [url] },
  ] }, evidence, location);
  assert.equal(result.water_concerns.length, 1);
});

test("known facilities outside 10 km and cancelled projects are excluded even with source coordinates", () => {
  const distant = { ...facility, latitude: 45.45 };
  const result = parseTavilyAssessment(report([distant, { ...facility, status: "cancelled" }]),
    [{ ...evidence[0], content: "Example campus located at 45.45, -76.3; alternate coordinates 45.32, -76.3." }], location);
  assert.equal(result.planned_data_centers.length, 0);
  assert.equal(result.closest_verified_facility_km, null);
});


test("temporary Gemini overload falls back to Flash-Lite using the existing Tavily evidence", async () => {
  let calls = 0;
  const result = await summarizeDataCenterEvidence(location, evidence, "gemini", "test", async (endpoint) => {
    calls++;
    assert.match(String(endpoint), calls === 1 ? /models\/test:generateContent/ : /models\/gemini-3\.1-flash-lite:generateContent/);
    return calls === 1 ? Response.json({ error: { message: "High demand" } }, { status: 503 }) : summaryResponse();
  });
  assert.equal(calls, 2);
  assert.equal(result.assessment_status, "reported");
});

test("persistent overload stops after two attempts and retains the unavailable-analysis state", async () => {
  let calls = 0;
  const result = await summarizeDataCenterEvidence(location, evidence, "gemini", "test", async () => {
    calls++;
    return Response.json({ error: { message: "High demand" } }, { status: 503 });
  });
  assert.equal(calls, 2);
  assert.equal(result.summary_status, "unavailable");
});


test("unspecified quota rejection does not trigger a fallback model request", async () => {
  let calls = 0;
  const result = await summarizeDataCenterEvidence(location, evidence, "gemini", "test", async () => {
    calls++;
    return Response.json({ error: { message: "Quota exceeded" } }, { status: 429 });
  });
  assert.equal(calls, 1);
  assert.equal(result.summary_status, "unavailable");
});


test("explicit primary-model daily exhaustion tries the configured alternative once", async () => {
  const models: string[] = [];
  const result = await summarizeDataCenterEvidence(location, evidence, "gemini", "gemini-3.8-flash", async (endpoint) => {
    models.push(String(endpoint));
    return models.length === 1 ? Response.json({ error: { message: "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash, description: Generate content requests per day limit exceeded on Free Tier." } }, { status: 429 }) : summaryResponse();
  });
  assert.equal(models.length, 2);
  assert.match(models[1], /gemini-3\.1-flash-lite:generateContent/);
  assert.equal(result.assessment_status, "reported");
});

test("does not retry daily exhaustion when the alternative is the same model", async () => {
  let calls = 0;
  const result = await summarizeDataCenterEvidence(location, evidence, "gemini", "test", async () => {
    calls++;
    return Response.json({ error: { message: "generate_content_free_tier_requests, model: test, requests per day limit exceeded" } }, { status: 429 });
  }, "test");
  assert.equal(calls, 1);
  assert.equal(result.summary_status, "unavailable");
});
