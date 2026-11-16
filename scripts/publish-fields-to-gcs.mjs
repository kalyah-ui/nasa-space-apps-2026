import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Storage } from "@google-cloud/storage";

const sourcePath = path.resolve(
  process.env.FIELDS_SOURCE_FILE ?? "data/fields/fields.geojson",
);
const bucketName =
  process.env.FIELDS_GCS_BUCKET ??
  process.env.GCS_BUCKET_NAME ??
  "nasa_spaceapps_2026_loam";
const objectName =
  process.env.FIELDS_GCS_OBJECT ?? "processed/fields/ontario-fields.geojson";

function parseCredentials() {
  const encoded = process.env.GCP_SERVICE_ACCOUNT_JSON_BASE64;
  const raw =
    process.env.GCP_SERVICE_ACCOUNT_JSON ??
    (encoded ? Buffer.from(encoded, "base64").toString("utf8") : undefined);
  if (!raw) return undefined;

  const value = JSON.parse(raw);
  if (
    typeof value.client_email !== "string" ||
    typeof value.private_key !== "string"
  ) {
    throw new Error(
      "The server-only service-account JSON must contain client_email and private_key.",
    );
  }
  return {
    client_email: value.client_email,
    private_key: value.private_key.replace(/\\n/g, "\n"),
  };
}

function validateCollection(value) {
  if (
    !value ||
    value.type !== "FeatureCollection" ||
    !Array.isArray(value.features) ||
    value.features.length === 0
  ) {
    throw new Error("The source must be a non-empty GeoJSON FeatureCollection.");
  }

  const ids = new Set();
  for (const [index, feature] of value.features.entries()) {
    if (
      !feature ||
      feature.type !== "Feature" ||
      typeof feature.id !== "string" ||
      !feature.id ||
      !feature.properties ||
      typeof feature.properties.name !== "string" ||
      typeof feature.properties.areaHectares !== "number" ||
      !feature.geometry ||
      !["Polygon", "MultiPolygon"].includes(feature.geometry.type)
    ) {
      throw new Error(`Feature ${index + 1} is not a stored field polygon.`);
    }
    if (ids.has(feature.id)) {
      throw new Error(`Duplicate field ID: ${feature.id}`);
    }
    ids.add(feature.id);
  }
}

async function main() {
  const raw = await readFile(sourcePath, "utf8");
  const collection = JSON.parse(raw);
  validateCollection(collection);

  const credentials = parseCredentials();
  const storage = new Storage({
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCLOUD_PROJECT ??
      "nasa-spaceapps-2026",
    ...(credentials ? { credentials } : {}),
  });
  const destination = storage.bucket(bucketName).file(objectName);
  await destination.save(`${JSON.stringify(collection)}\n`, {
    resumable: false,
    contentType: "application/geo+json",
    metadata: {
      cacheControl: "private, no-store",
      metadata: {
        featureCount: String(collection.features.length),
        sourceFile: path.basename(sourcePath),
      },
    },
  });

  const [metadata] = await destination.getMetadata();
  console.log(
    `Published ${collection.features.length} private field polygons to gs://${bucketName}/${objectName} (${metadata.size} bytes).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
