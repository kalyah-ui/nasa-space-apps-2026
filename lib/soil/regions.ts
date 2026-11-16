import "server-only";

import area from "@turf/area";
import polygonClipping from "polygon-clipping";
import type { FieldGeometry } from "@/lib/fields/types";
import { getDataBucketName, getServerStorage } from "@/lib/gcs/storage";
import { rateSoilRegion, soilCropLabels } from "./suitability";
import {
  soilCropIds,
  type PreparedSoilRegionProperties,
  type SoilCropId,
  type SoilRegionCollection,
  type SoilRegionFeature,
} from "./types";

const bucketName = getDataBucketName(process.env.SOIL_GCS_BUCKET);
const objectName =
  process.env.CANSIS_PROCESSED_OBJECT ??
  "processed/cansis-slc-v3-2/ontario-regions.geojson";
const storage = getServerStorage();

type PreparedFeature = Omit<SoilRegionFeature, "properties"> & {
  properties: PreparedSoilRegionProperties;
};
type PreparedCollection = {
  type: "FeatureCollection";
  features: PreparedFeature[];
};
type Bounds = [west: number, south: number, east: number, north: number];

let preparedCache: Promise<PreparedCollection> | null = null;

export class InvalidSoilRegionRequestError extends Error {}
export class MissingPreparedSoilDataError extends Error {}

function overlaps(first: Bounds, second: Bounds) {
  return !(
    first[2] < second[0] ||
    first[0] > second[2] ||
    first[3] < second[1] ||
    first[1] > second[3]
  );
}

function parseCollection(data: Buffer): PreparedCollection {
  const collection = JSON.parse(data.toString("utf8")) as PreparedCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("The prepared CanSIS object is not a GeoJSON FeatureCollection.");
  }
  return collection;
}

async function loadPreparedCollection() {
  if (!preparedCache) {
    preparedCache = storage
      .bucket(bucketName)
      .file(objectName)
      .download()
      .then(([data]) => parseCollection(data))
      .catch((error: NodeJS.ErrnoException & { code?: number }) => {
        preparedCache = null;
        if (error.code === 404) {
          throw new MissingPreparedSoilDataError(
            "Prepared Ontario CanSIS data is missing. Run npm run prepare:soil-regions with Google Application Default Credentials.",
          );
        }
        throw error;
      });
  }
  return preparedCache;
}

function toMultiPolygon(geometry: FieldGeometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function overlapPercent(region: PreparedFeature, field: FieldGeometry | null) {
  if (!field) return null;
  try {
    const clipped = polygonClipping.intersection(
      toMultiPolygon(region.geometry),
      toMultiPolygon(field),
    );
    if (clipped.length === 0) return null;
    const fieldArea = area({ type: "Feature", properties: {}, geometry: field });
    if (fieldArea <= 0) return null;
    const clippedArea = area({
      type: "Feature",
      properties: {},
      geometry: { type: "MultiPolygon", coordinates: clipped },
    });
    return Number(Math.min(100, (clippedArea / fieldArea) * 100).toFixed(1));
  } catch {
    return null;
  }
}

export function parseSoilCrop(value: unknown): SoilCropId {
  if (typeof value === "string" && soilCropIds.includes(value as SoilCropId)) {
    return value as SoilCropId;
  }
  throw new InvalidSoilRegionRequestError("Select a supported crop.");
}

export function parseBounds(value: unknown): Bounds {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) {
    throw new InvalidSoilRegionRequestError("A valid map bounding box is required.");
  }
  const bounds = value as Bounds;
  if (
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3] ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -90 ||
    bounds[3] > 90
  ) {
    throw new InvalidSoilRegionRequestError("The map bounding box is invalid.");
  }
  return bounds;
}

export async function getSoilRegions(
  bounds: Bounds,
  crop: SoilCropId,
  field: FieldGeometry | null,
): Promise<SoilRegionCollection> {
  const prepared = await loadPreparedCollection();
  const visible = prepared.features.filter((feature) =>
    overlaps(feature.properties.bbox, bounds),
  );
  return {
    type: "FeatureCollection",
    features: visible.map((feature) => {
      const suitability = rateSoilRegion(feature.properties, crop);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          crop,
          cropLabel: soilCropLabels[crop],
          ...suitability,
          overlapPercent: overlapPercent(feature, field),
          note: "Regional estimate, not a soil test",
        },
      };
    }),
  };
}

