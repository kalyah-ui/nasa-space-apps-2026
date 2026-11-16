import type {
  Coordinate,
  DataProvider,
  DataProvenance,
  DataSample,
  FieldSpec,
  LayerData,
  LayerId,
  LayerSpec,
  PointInspection,
} from "./types";

const demoProvenance: DataProvenance = {
  kind: "demo",
  label: "DEMO DATA — synthetic values for preview only",
};

const field: FieldSpec = {
  id: "demo-field-01",
  name: "Demo Field 01",
  area: 34.9,
  areaUnit: "ha",
  boundary: {
    type: "Polygon",
    coordinates: [[
      [-93.72, 41.58],
      [-93.714, 41.58],
      [-93.714, 41.58633],
      [-93.72, 41.58633],
      [-93.72, 41.58],
    ]],
  },
  provenance: demoProvenance,
  healthScore: {
    value: 74,
    label: "Illustrative demo score",
    note: "Example only; not calculated using an approved loam scoring methodology.",
    subScores: [
      { id: "vegetation", label: "Vegetation health", value: 78 },
      { id: "soil-cover", label: "Soil cover", value: 69 },
      { id: "moisture", label: "Moisture balance", value: 73 },
      { id: "terrain", label: "Terrain suitability", value: 81 },
    ],
  },
};

const dates = ["2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15"];

const layerSpecs: LayerSpec[] = [
  {
    id: "satellite",
    label: "Satellite image",
    category: "basemap",
    available: true,
    units: "Landsat 8 true colour",
  },
  {
    id: "productivity",
    label: "Productivity map",
    category: "thematic",
    available: true,
    units: "relative demo score (0–100)",
    legend: {
      min: 0,
      max: 100,
      units: "relative demo score",
      stops: [
        { value: 0, color: "#d83b36" },
        { value: 50, color: "#f0d846" },
        { value: 100, color: "#25a66a" },
      ],
    },
  },
  {
    id: "soil-brightness",
    label: "Soil brightness",
    category: "thematic",
    available: true,
    units: "demo index (0–1)",
    legend: {
      min: 0,
      max: 1,
      units: "demo index",
      stops: [
        { value: 0, color: "#382b22" },
        { value: 0.5, color: "#a77a4b" },
        { value: 1, color: "#ead7aa" },
      ],
    },
  },
  {
    id: "elevation",
    label: "Elevation",
    category: "thematic",
    available: true,
    units: "metres",
  },
  ...([
    { id: "ndvi", min: 0, max: 1 },
    { id: "ndre", min: 0, max: 1 },
    { id: "msavi", min: 0, max: 1 },
  ] as const).map(({ id, min, max }): LayerSpec => ({
    id,
    label: id.toUpperCase(),
    category: "vegetation",
    available: true,
    units: id === "ndvi" ? "NDVI" : "demo index",
    legend: {
      min,
      max,
      units: "demo index",
      stops: [
        { value: min, color: "#d83b36" },
        { value: (min + max) / 2, color: "#f0d846" },
        { value: max, color: "#25a66a" },
      ],
    },
  })),
  {
    id: "moisture",
    label: "Moisture",
    category: "moisture",
    available: true,
    units: "demo index (0–1)",
    legend: {
      min: 0,
      max: 1,
      units: "demo index",
      stops: [
        { value: 0, color: "#d8b15c" },
        { value: 0.5, color: "#76b7a5" },
        { value: 1, color: "#2867a0" },
      ],
    },
  },
];

const temporalLayerIds = new Set<LayerId>([
  "productivity",
  "ndvi",
  "ndre",
  "msavi",
  "moisture",
]);

const layerIdsWithData = layerSpecs
  .filter((layer) => layer.category !== "basemap")
  .map((layer) => layer.id);

function assertKnownField(fieldId: string): void {
  if (fieldId !== field.id) {
    throw new Error(`Mock data does not contain field "${fieldId}".`);
  }
}

function getLayerSpec(layerId: LayerId): LayerSpec {
  const layer = layerSpecs.find((spec) => spec.id === layerId);
  if (!layer) {
    throw new Error(`Mock data does not contain layer "${layerId}".`);
  }
  if (!layer.available) {
    throw new Error(layer.unavailableReason ?? `Layer "${layer.label}" is unavailable.`);
  }
  return layer;
}

function getDate(layerId: LayerId, date?: string): string {
  const layerDates = temporalLayerIds.has(layerId) ? dates : [dates[0]];
  const selectedDate = date ?? layerDates[layerDates.length - 1];
  if (!layerDates.includes(selectedDate)) {
    throw new Error(`No demo data for layer "${layerId}" on ${selectedDate}.`);
  }
  return selectedDate;
}

function createSampleCoordinates(): Array<Omit<DataSample, "value">> {
  const samples: Array<Omit<DataSample, "value">> = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const horizontal = column / 4;
      const vertical = row / 4;
      samples.push({
        id: `demo-sample-${row}-${column}`,
        coordinates: [
          -93.7195 + horizontal * 0.005,
          41.581 + vertical * 0.0043,
        ],
      });
    }
  }

  return samples;
}

function layerValue(layerId: LayerId, sampleIndex: number, date: string): number {
  const row = Math.floor(sampleIndex / 5);
  const column = sampleIndex % 5;
  const dateIndex = Math.max(0, dates.indexOf(date));
  const wave = Math.sin((row + 1) * 1.7 + column * 0.8);

  switch (layerId) {
    case "productivity":
      return Number(Math.max(0, Math.min(100, Math.round(52 + wave * 32 + dateIndex * 3))));
    case "soil-brightness":
      return Number((0.42 + Math.cos(row * 0.9 + column) * 0.24).toFixed(3));
    case "elevation":
      return Number((282 + row * 3 + column * 1.4).toFixed(1));
    case "ndvi":
      return Number(Math.min(0.94, 0.42 + wave * 0.18 + dateIndex * 0.07).toFixed(3));
    case "ndre":
      return Number(Math.min(0.88, 0.31 + wave * 0.15 + dateIndex * 0.055).toFixed(3));
    case "msavi":
      return Number(Math.min(0.9, 0.38 + wave * 0.17 + dateIndex * 0.06).toFixed(3));
    case "moisture":
      return Number(Math.min(0.9, 0.28 + Math.cos(row + column * 0.7) * 0.12 + dateIndex * 0.04).toFixed(3));
    case "satellite":
      throw new Error("Satellite basemap does not provide analytic sample values.");
  }
}

function buildLayerData(layerId: LayerId, date: string): LayerData {
  getLayerSpec(layerId);
  const selectedDate = getDate(layerId, date);

  return {
    fieldId: field.id,
    layerId,
    date: selectedDate,
    provenance: demoProvenance,
    samples: createSampleCoordinates().map((sample, index) => ({
      ...sample,
      value: layerValue(layerId, index, selectedDate),
    })),
  };
}

function isInsideField([longitude, latitude]: Coordinate): boolean {
  const ring =
    field.boundary.type === "Polygon"
      ? field.boundary.coordinates[0]
      : field.boundary.coordinates[0][0];
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previous];
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    const intersectionLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;

    if (crossesLatitude && longitude < intersectionLongitude) {
      inside = !inside;
    }
  }

  return inside;
}

function distanceMeters(first: Coordinate, second: Coordinate): number {
  const meanLatitude = ((first[1] + second[1]) / 2) * (Math.PI / 180);
  const longitudeMeters = (first[0] - second[0]) * 111_320 * Math.cos(meanLatitude);
  const latitudeMeters = (first[1] - second[1]) * 111_320;
  return Math.hypot(longitudeMeters, latitudeMeters);
}

export class MockProvider implements DataProvider {
  async listFields() {
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          id: field.id,
          properties: { name: field.name, areaHectares: field.area },
          geometry: field.boundary,
        },
      ],
    };
  }

  async getField(fieldId: string): Promise<FieldSpec | null> {
    return fieldId === field.id ? field : null;
  }

  async listLayers(fieldId: string): Promise<LayerSpec[]> {
    assertKnownField(fieldId);
    return layerSpecs.map((layer) => ({ ...layer }));
  }

  async getMapOverlay(): Promise<never> {
    throw new Error("Raster overlays are unavailable from the mock provider.");
  }

  async getSoilRegions(): Promise<never> {
    throw new Error("Regional CanSIS soil data is unavailable from the mock provider.");
  }

  async getSoilTests(): Promise<never> {
    throw new Error("Private soil-test storage is unavailable from the mock provider.");
  }

  async uploadSoilTest(): Promise<never> {
    throw new Error("Private soil-test storage is unavailable from the mock provider.");
  }

  async listLayerDates(fieldId: string, layerId: LayerId): Promise<string[]> {
    assertKnownField(fieldId);
    getLayerSpec(layerId);
    return temporalLayerIds.has(layerId) ? [...dates] : [dates[0]];
  }

  async getLayerData(fieldId: string, layerId: LayerId, date?: string): Promise<LayerData> {
    assertKnownField(fieldId);
    const selectedDate = getDate(layerId, date);
    return buildLayerData(layerId, selectedDate);
  }

  async inspectPoint(
    fieldId: string,
    coordinates: Coordinate,
    date?: string,
  ): Promise<PointInspection> {
    assertKnownField(fieldId);
    if (!isInsideField(coordinates)) {
      throw new Error("The selected point is outside the demo field boundary.");
    }

    const selectedDate = getDate("ndvi", date);
    const samples = createSampleCoordinates();
    const nearest = samples.reduce((best, sample) =>
      distanceMeters(coordinates, sample.coordinates) <
      distanceMeters(coordinates, best.coordinates)
        ? sample
        : best,
    );

    const values: Partial<Record<LayerId, number>> = {};
    for (const layerId of layerIdsWithData) {
      values[layerId] = layerValue(layerId, samples.indexOf(nearest), selectedDate);
    }

    return {
      fieldId: field.id,
      date: selectedDate,
      coordinates,
      sampledCoordinates: nearest.coordinates,
      distanceMeters: Number(distanceMeters(coordinates, nearest.coordinates).toFixed(1)),
      values,
      provenance: demoProvenance,
    };
  }
}
