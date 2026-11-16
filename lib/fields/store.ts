import "server-only";

import { randomUUID } from "node:crypto";
import { getDataBucketName, getServerStorage } from "@/lib/gcs/storage";
import type {
  StoredFieldCollection,
  StoredFieldFeature,
} from "./types";
import { getAreaHectares, parseFieldGeometry, validateFieldName } from "./validation";

const bucketName = getDataBucketName(process.env.FIELDS_GCS_BUCKET);
const objectName =
  process.env.FIELDS_GCS_OBJECT ?? "processed/fields/ontario-fields.geojson";
const storage = getServerStorage();

let writeQueue: Promise<unknown> = Promise.resolve();
let cachedCollection: StoredFieldCollection | null = null;

async function writeCollection(collection: StoredFieldCollection): Promise<void> {
  await storage
    .bucket(bucketName)
    .file(objectName)
    .save(`${JSON.stringify(collection)}\n`, {
      resumable: false,
      contentType: "application/geo+json",
      metadata: { cacheControl: "private, no-store" },
    });
  cachedCollection = collection;
}

async function readCollection(): Promise<StoredFieldCollection> {
  if (cachedCollection) return cachedCollection;
  try {
    const [buffer] = await storage.bucket(bucketName).file(objectName).download();
    const parsed = JSON.parse(buffer.toString("utf8")) as StoredFieldCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
      throw new Error("Stored fields are not a valid GeoJSON FeatureCollection.");
    }
    cachedCollection = parsed;
    return parsed;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      throw new Error(
        `The field catalog gs://${bucketName}/${objectName} is missing. Run npm run publish:fields with server-side Google Cloud credentials before deploying.`,
        { cause: error },
      );
    }
    throw error;
  }
}

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function listFields(): Promise<StoredFieldCollection> {
  await writeQueue;
  return readCollection();
}

export function createField(nameValue: unknown, geometryValue: unknown) {
  return serializeMutation(async () => {
    const collection = await readCollection();
    const name = validateFieldName(nameValue);
    const geometry = parseFieldGeometry(geometryValue);
    const field: StoredFieldFeature = {
      type: "Feature",
      id: randomUUID(),
      properties: { name, areaHectares: getAreaHectares(geometry) },
      geometry,
    };
    await writeCollection({
      ...collection,
      features: [...collection.features, field],
    });
    return field;
  });
}

export function updateField(
  id: string,
  updates: { name?: unknown; geometry?: unknown },
) {
  return serializeMutation(async () => {
    const collection = await readCollection();
    const index = collection.features.findIndex((field) => field.id === id);
    if (index < 0) {
      return null;
    }

    const current = collection.features[index];
    const name = updates.name === undefined
      ? current.properties.name
      : validateFieldName(updates.name);
    const geometry = updates.geometry === undefined
      ? current.geometry
      : parseFieldGeometry(updates.geometry);
    const updated: StoredFieldFeature = {
      ...current,
      properties: { name, areaHectares: getAreaHectares(geometry) },
      geometry,
    };
    const features = [...collection.features];
    features[index] = updated;
    await writeCollection({ ...collection, features });
    return updated;
  });
}

export function deleteField(id: string) {
  return serializeMutation(async () => {
    const collection = await readCollection();
    const nextFeatures = collection.features.filter((field) => field.id !== id);
    if (nextFeatures.length === collection.features.length) {
      return false;
    }
    await writeCollection({ ...collection, features: nextFeatures });
    return true;
  });
}
