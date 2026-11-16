import "server-only";

import { Storage, type StorageOptions } from "@google-cloud/storage";

type ServiceAccountCredentials = {
  client_email?: unknown;
  private_key?: unknown;
};

function parseCredentials(): StorageOptions["credentials"] | undefined {
  const encoded = process.env.GCP_SERVICE_ACCOUNT_JSON_BASE64;
  const raw =
    process.env.GCP_SERVICE_ACCOUNT_JSON ??
    (encoded ? Buffer.from(encoded, "base64").toString("utf8") : undefined);
  if (!raw) return undefined;

  let value: ServiceAccountCredentials;
  try {
    value = JSON.parse(raw) as ServiceAccountCredentials;
  } catch {
    throw new Error(
      "GCP_SERVICE_ACCOUNT_JSON is not valid JSON. Configure the complete service-account JSON as a server-only deployment secret.",
    );
  }
  if (
    typeof value.client_email !== "string" ||
    typeof value.private_key !== "string"
  ) {
    throw new Error(
      "GCP_SERVICE_ACCOUNT_JSON must include client_email and private_key.",
    );
  }
  return {
    client_email: value.client_email,
    private_key: value.private_key.replace(/\\n/g, "\n"),
  };
}

let storageClient: Storage | null = null;

export function getServerStorage(): Storage {
  if (!storageClient) {
    const credentials = parseCredentials();
    storageClient = new Storage({
      projectId:
        process.env.GOOGLE_CLOUD_PROJECT ??
        process.env.GCLOUD_PROJECT ??
        "nasa-spaceapps-2026",
      ...(credentials ? { credentials } : {}),
    });
  }
  return storageClient;
}

export function getDataBucketName(override?: string): string {
  return override || process.env.GCS_BUCKET_NAME || "nasa_spaceapps_2026_loam";
}

