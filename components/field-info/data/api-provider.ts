import type {
  DataProvider,
  FieldCollection,
  FieldCollectionFeature,
  FieldSpec,
  LayerData,
  LayerId,
  LayerSpec,
  MapOverlayData,
  PointInspection,
  SoilCropId,
  SoilRegionCollection,
} from "./types";

const liveProvenance = {
  kind: "live" as const,
  label: "LIVE DATA",
};

const liveLayers: LayerSpec[] = [
  { id: "satellite", label: "Satellite image", category: "basemap", available: true },
  { id: "productivity", label: "Productivity map", category: "thematic", available: true, units: "regional soil suitability" },
  { id: "soil-brightness", label: "Soil brightness", category: "thematic", available: false, unavailableReason: "A live soil-brightness provider is not configured." },
  { id: "elevation", label: "Elevation", category: "thematic", available: true, units: "metres" },
  { id: "ndvi", label: "NDVI", category: "vegetation", available: true, units: "NDVI" },
  ...(["ndre", "msavi"] as const).map(
    (id): LayerSpec => ({
      id,
      label: id.toUpperCase(),
      category: "vegetation",
      available: false,
      unavailableReason: `${id.toUpperCase()} requires additional verified Landsat or Sentinel bands.`,
    }),
  ),
  { id: "moisture", label: "Moisture", category: "moisture", available: false, unavailableReason: "A live moisture provider is not configured." },
];

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json()) as T | { message?: unknown };
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : fallback;
    throw new Error(message);
  }
  return data as T;
}

function toFieldSpec(field: FieldCollectionFeature): FieldSpec {
  return {
    id: field.id,
    name: field.properties.name,
    area: field.properties.areaHectares,
    areaUnit: "ha",
    boundary: field.geometry,
    provenance: liveProvenance,
    healthScore: {
      value: 0,
      label: "Not calculated",
      note: "No composite health score is calculated for live fields.",
      subScores: [],
    },
  };
}

export class ApiProvider implements DataProvider {
  constructor(
    private readonly config: {
      soilRegions: { endpoint: string };
    } = { soilRegions: { endpoint: "/api/soil-regions" } },
  ) {}

  async listFields(signal?: AbortSignal): Promise<FieldCollection> {
    return readJson<FieldCollection>(
      await fetch("/api/fields", { cache: "no-store", signal }),
      "Stored field boundaries could not be loaded.",
    );
  }

  async getField(fieldId: string): Promise<FieldSpec | null> {
    const collection = await this.listFields();
    const field = collection.features.find((candidate) => candidate.id === fieldId);
    return field ? toFieldSpec(field) : null;
  }

  async listLayers(): Promise<LayerSpec[]> {
    return liveLayers.map((layer) => ({ ...layer }));
  }

  async getMapOverlay(
    field: FieldCollectionFeature,
    layerId: "satellite" | "ndvi" | "elevation",
    signal?: AbortSignal,
  ): Promise<MapOverlayData> {
    const endpoint = layerId === "elevation" ? "/api/elevation" : "/api/landsat";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry: field.geometry, layer: layerId }),
      signal,
    });
    if (layerId === "elevation") {
      const data = await readJson<{
        image: string;
        bounds: { west: number; south: number; east: number; north: number };
        legend: MapOverlayData["legend"];
      }>(response, "Elevation could not be loaded for the selected field.");
      return {
        image: data.image,
        coordinates: [
          [data.bounds.west, data.bounds.north],
          [data.bounds.east, data.bounds.north],
          [data.bounds.east, data.bounds.south],
          [data.bounds.west, data.bounds.south],
        ],
        averageNdvi: null,
        clearPixelPercent: 100,
        maskedPixelPercent: 0,
        imageDate: "",
        source: "NASA SRTM",
        sceneId: "",
        provider: "bucket-sample",
        legend: data.legend,
      };
    }
    return readJson<MapOverlayData>(
      response,
      "Landsat imagery could not be loaded for the selected field.",
    );
  }

  async listLayerDates(_fieldId: string, _layerId: LayerId): Promise<string[]> {
    return [];
  }

  async getSoilRegions(
    bounds: [number, number, number, number],
    crop: SoilCropId,
    field?: FieldCollectionFeature | null,
    signal?: AbortSignal,
  ): Promise<SoilRegionCollection> {
    return readJson<SoilRegionCollection>(
      await fetch(this.config.soilRegions.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bbox: bounds,
          crop,
          fieldGeometry: field?.geometry ?? null,
        }),
        cache: "no-store",
        signal,
      }),
      "Regional soil suitability could not be loaded.",
    );
  }

  async getLayerData(
    _fieldId: string,
    _layerId: LayerId,
    _date?: string,
  ): Promise<LayerData> {
    throw new Error("Gridded live layer samples are not exposed by this provider.");
  }

  async inspectPoint(): Promise<PointInspection> {
    throw new Error("Live point inspection is not implemented.");
  }
}
