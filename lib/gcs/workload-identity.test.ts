import assert from "node:assert/strict";
import test from "node:test";
import { createWorkloadIdentityClient } from "./workload-identity";

const env = {
  GCP_PROJECT_NUMBER: "123456789012",
  GCP_SERVICE_ACCOUNT_EMAIL: "loam-vercel@nasa-spaceapps-2026.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
};

test("local ADC and Cloud Run do not require Vercel credentials", () => {
  assert.equal(createWorkloadIdentityClient({}, async () => "unused"), undefined);
});

test("partial federation configuration fails before contacting Google", () => {
  assert.throws(
    () => createWorkloadIdentityClient({ GCP_PROJECT_NUMBER: "123" }, async () => "unused"),
    /Incomplete.*GCP_SERVICE_ACCOUNT_EMAIL.*GCP_WORKLOAD_IDENTITY_POOL_ID/,
  );
});

test("rejects a project ID in place of its number", () => {
  assert.throws(
    () => createWorkloadIdentityClient({ ...env, GCP_PROJECT_NUMBER: "nasa-spaceapps-2026" }, async () => "unused"),
    /numeric project number/,
  );
});

test("rejects malformed provider IDs and service account emails", () => {
  for (const overrides of [
    { GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel/other" },
    { GCP_SERVICE_ACCOUNT_EMAIL: "person@example.com" },
  ]) {
    assert.throws(() => createWorkloadIdentityClient({ ...env, ...overrides }, async () => "unused"));
  }
});

test("gets a current Vercel token on demand without capturing the first token", async () => {
  let calls = 0;
  const client = createWorkloadIdentityClient(env, async () => `token-${++calls}`)!;
  assert.equal(calls, 0);
  assert.equal(await client.retrieveSubjectToken(), "token-1");
  assert.equal(await client.retrieveSubjectToken(), "token-2");
  assert.equal(client.getServiceAccountEmail(), env.GCP_SERVICE_ACCOUNT_EMAIL);
});
