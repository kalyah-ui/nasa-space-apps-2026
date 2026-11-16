import { IdentityPoolClient } from "google-auth-library";

const configurationKeys = [
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
] as const;

/** Return no client for local ADC/Cloud Run; fail clearly on partial OIDC setup. */
export function createWorkloadIdentityClient(
  env: Record<string, string | undefined>,
  getSubjectToken: () => Promise<string>,
): IdentityPoolClient | undefined {
  if (!configurationKeys.some((key) => env[key]?.trim())) return undefined;

  const missing = configurationKeys.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Incomplete Google workload identity configuration. Set: ${missing.join(", ")}.`);
  }

  const projectNumber = env.GCP_PROJECT_NUMBER!.trim();
  const serviceAccount = env.GCP_SERVICE_ACCOUNT_EMAIL!.trim();
  const pool = env.GCP_WORKLOAD_IDENTITY_POOL_ID!.trim();
  const provider = env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID!.trim();
  if (!/^\d+$/.test(projectNumber)) {
    throw new Error("GCP_PROJECT_NUMBER must be the numeric project number, not the project ID.");
  }
  if (![pool, provider].every((id) => /^[a-z0-9-]+$/.test(id))) {
    throw new Error("Google workload identity pool and provider IDs must contain only lowercase letters, numbers, and hyphens.");
  }
  if (!/^[a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(serviceAccount)) {
    throw new Error("GCP_SERVICE_ACCOUNT_EMAIL must be a Google service account email.");
  }

  return new IdentityPoolClient({
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
    subject_token_supplier: {
      // Retrieve a current token on refresh, rather than capturing a build token.
      getSubjectToken,
    },
  });
}
