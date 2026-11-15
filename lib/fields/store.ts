import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FieldGeometry,
  StoredFieldCollection,
  StoredFieldFeature,
} from "./types";
import { getAreaHectares, parseFieldGeometry, validateFieldName } from "./validation";

const fieldDirectory = path.join(process.cwd(), "data", "fields");
const fieldFile = path.join(fieldDirectory, "fields.geojson");
const legacyFiles = [
  { id: "plot-a", path: path.join(process.cwd(), "public", "data", "PlotA.geojson") },
  { id: "plot-b", path: path.join(process.cwd(), "public", "data", "PlotB.geojson") },
];

let writeQueue: Promise<unknown> = Promise.resolve();

type RawFeature = {
  type?: unknown;
  properties?: { name?: unknown } | null;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
};

function normalizeLegacyGeometry(feature: RawFeature): FieldGeometry {
  const geometry = feature.geometry;
  if (!geometry) {
    throw new Error("Legacy field boundary has no geometry.");
  }

  if (geometry.type === "LineString") {
    return parseFieldGeometry({
      type: "Polygon",
      coordinates: [geometry.coordinates],
    });
  }

  return parseFieldGeometry(geometry);
}

async function seedLegacyFields(): Promise<StoredFieldCollection> {
  const features: StoredFieldFeature[] = [];

  for (const legacy of legacyFiles) {
    const raw = JSON.parse(await readFile(legacy.path, "utf8")) as {
      features?: unknown;
    };
    if (!Array.isArray(raw.features)) {
      continue;
    }

    raw.features.forEach((value, index) => {
      const source = value as RawFeature;
      const geometry = normalizeLegacyGeometry(source);
      const name = validateFieldName(source.properties?.name ?? `Field ${index + 1}`);
      features.push({
        type: "Feature",
        id: index === 0 ? legacy.id : `${legacy.id}-${index + 1}`,
        properties: { name, areaHectares: getAreaHectares(geometry) },
        geometry,
      });
    });
  }

  return { type: "FeatureCollection", features };
}

async function writeCollection(collection: StoredFieldCollection): Promise<void> {
  await mkdir(fieldDirectory, { recursive: true });
  const temporaryFile = `${fieldFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
  await rename(temporaryFile, fieldFile);
}

async function readCollection(): Promise<StoredFieldCollection> {
  try {
    const parsed = JSON.parse(await readFile(fieldFile, "utf8")) as StoredFieldCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
      throw new Error("Stored fields are not a valid GeoJSON FeatureCollection.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const seeded = await seedLegacyFields();
    await writeCollection(seeded);
    return seeded;
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
    collection.features.push(field);
    await writeCollection(collection);
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
    collection.features[index] = updated;
    await writeCollection(collection);
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
