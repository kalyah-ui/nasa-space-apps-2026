export type FieldGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface FieldOption {
  id: string;
  name: string;
  geometry: FieldGeometry;
}

export const FIELD_BOUNDARY_URLS = ["/data/PlotA.geojson", "/data/PlotB.geojson"] as const;
export const SELECTED_FIELD_STORAGE_KEY = "loam-selected-field";

type ApiFieldCollection = {
  type?: unknown;
  features?: Array<{
    type?: unknown;
    id?: unknown;
    properties?: { name?: unknown } | null;
    geometry?: RawFeature["geometry"];
  }>;
};

type RawFeature = {
  type?: unknown;
  properties?: { name?: unknown } | null;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
};

type RawFeatureCollection = {
  type?: unknown;
  features?: unknown;
};

function parsePosition(value: unknown, sourceName: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) {
    throw new Error(`${sourceName} contains an invalid coordinate.`);
  }
  return value;
}

function closeRing(coordinates: unknown, sourceName: string): number[][] {
  if (!Array.isArray(coordinates)) {
    throw new Error(`${sourceName} contains an invalid boundary.`);
  }
  const ring = coordinates.map((coordinate) => parsePosition(coordinate, sourceName));
  if (ring.length < 3) {
    throw new Error(`${sourceName} needs at least three boundary coordinates.`);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }
  return ring;
}

function normalizeGeometry(feature: RawFeature, sourceName: string): FieldGeometry {
  const geometry = feature.geometry;
  if (!geometry) {
    throw new Error(`${sourceName} contains a feature without geometry.`);
  }
  if (geometry.type === "LineString") {
    return { type: "Polygon", coordinates: [closeRing(geometry.coordinates, sourceName)] };
  }
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => closeRing(ring, sourceName)),
    };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) => {
        if (!Array.isArray(polygon)) {
          throw new Error(`${sourceName} contains an invalid multipolygon.`);
        }
        return polygon.map((ring) => closeRing(ring, sourceName));
      }),
    };
  }
  throw new Error(`${sourceName} must contain LineString, Polygon, or MultiPolygon boundaries.`);
}

export async function loadFieldCatalog(signal?: AbortSignal): Promise<FieldOption[]> {
  const apiResponse = await fetch("/api/fields", { cache: "no-store", signal });
  if (apiResponse.ok) {
    const collection = (await apiResponse.json()) as ApiFieldCollection;
    if (collection.type === "FeatureCollection" && Array.isArray(collection.features)) {
      const fields = collection.features.flatMap((feature, index) => {
        const name = feature.properties?.name;
        const id = feature.id;
        if (
          feature.type !== "Feature" ||
          (typeof id !== "string" && typeof id !== "number") ||
          typeof name !== "string" ||
          !name.trim()
        ) {
          return [];
        }
        return [{
          id: String(id),
          name: name.trim(),
          geometry: normalizeGeometry(
            { type: "Feature", geometry: feature.geometry },
            `field ${index + 1}`,
          ),
        }];
      });
      if (fields.length > 0) return fields;
    }
  }

  const collections = await Promise.all(
    FIELD_BOUNDARY_URLS.map(async (url) => {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`Could not load ${url} (${response.status} ${response.statusText}).`);
      }
      return { url, data: (await response.json()) as RawFeatureCollection };
    }),
  );

  const fields = collections.flatMap(({ url, data }) => {
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error(`${url} is not a valid GeoJSON FeatureCollection.`);
    }
    return data.features.map((value) => {
      const feature = value as RawFeature;
      const name = feature.properties?.name;
      if (feature.type !== "Feature" || typeof name !== "string" || !name.trim()) {
        throw new Error(`${url} contains a field without a valid name.`);
      }
      return {
        id: name.trim(),
        name: name.trim(),
        geometry: normalizeGeometry(feature, url),
      };
    });
  });

  if (fields.length === 0) {
    throw new Error("No field boundaries were found in Field Info.");
  }
  return fields;
}
