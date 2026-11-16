export type Coordinate = [longitude: number, latitude: number];

export type FieldGeometry =
  | { type: "Polygon"; coordinates: Coordinate[][] }
  | { type: "MultiPolygon"; coordinates: Coordinate[][][] };

export type DataProvenance = {
  kind: "demo" | "live";
  label: string;
};

export type LayerCategory =
  | "basemap"
  | "thematic"
  | "vegetation"
  | "moisture";

export type LayerId =
  | "satellite"
  | "productivity"
  | "soil-brightness"
  | "elevation"
  | "ndvi"
  | "ndre"
  | "msavi"
  | "moisture";

export type LegendSpec = {
  min: number;
  max: number;
  units: string;
  stops: Array<{ value: number; color: string }>;
};

export type LayerSpec = {
  id: LayerId;
  label: string;
  category: LayerCategory;
  available: boolean;
  unavailableReason?: string;
  units?: string;
  legend?: LegendSpec;
};

export type FieldSpec = {
  id: string;
  name: string;
  area: number;
  areaUnit: string;
  boundary: FieldGeometry;
  provenance: DataProvenance;
  healthScore: {
    value: number;
    label: string;
    note: string;
    subScores: Array<{ id: string; label: string; value: number }>;
  };
};

export type DataSample = {
  id: string;
  coordinates: Coordinate;
  value: number;
};

export type LayerData = {
  fieldId: string;
  layerId: LayerId;
  date: string;
  provenance: DataProvenance;
  samples: DataSample[];
};

export type PointInspection = {
  fieldId: string;
  date: string;
  coordinates: Coordinate;
  sampledCoordinates: Coordinate;
  distanceMeters: number;
  values: Partial<Record<LayerId, number>>;
  provenance: DataProvenance;
};

export type FieldCollectionFeature = {
  type: "Feature";
  id: string;
  properties: { name: string; areaHectares: number };
  geometry: FieldGeometry;
};

export type FieldCollection = {
  type: "FeatureCollection";
  features: FieldCollectionFeature[];
};

export type MapOverlayData = {
  image: string;
  coordinates: [Coordinate, Coordinate, Coordinate, Coordinate];
  averageNdvi: number | null;
  clearPixelPercent: number;
  maskedPixelPercent: number;
  imageDate: string;
  source: string;
  sceneId: string;
  provider: "bucket-sample" | "planetary-computer";
  legend: null | LegendSpec;
};

export type SoilCropId =
  | "corn"
  | "soybean"
  | "winter-wheat"
  | "canola"
  | "forage";

export type SoilRegionCollection = import("@/lib/soil/types").SoilRegionCollection;
export type SoilTestCollection = import("@/lib/soil/upload-types").SoilTestCollection;
export type SoilCsvMapping = import("@/lib/soil/upload-types").SoilCsvMapping;
export type SoilSamplingScope = import("@/lib/soil/upload-types").SoilSamplingScope;

export interface DataProvider {
  listFields(signal?: AbortSignal): Promise<FieldCollection>;
  getField(fieldId: string): Promise<FieldSpec | null>;
  listLayers(fieldId?: string): Promise<LayerSpec[]>;
  getMapOverlay(
    field: FieldCollectionFeature,
    layerId: "satellite" | "ndvi" | "elevation",
    signal?: AbortSignal,
  ): Promise<MapOverlayData>;
  getSoilRegions(
    bounds: [number, number, number, number],
    crop: SoilCropId,
    field?: FieldCollectionFeature | null,
    signal?: AbortSignal,
  ): Promise<SoilRegionCollection>;
  getSoilTests(fieldId: string, crop: SoilCropId, signal?: AbortSignal): Promise<SoilTestCollection>;
  uploadSoilTest(fieldId: string, form: FormData, signal?: AbortSignal): Promise<SoilTestCollection["uploads"][number]>;
  listLayerDates(fieldId: string, layerId: LayerId): Promise<string[]>;
  getLayerData(fieldId: string, layerId: LayerId, date?: string): Promise<LayerData>;
  inspectPoint(
    fieldId: string,
    coordinates: Coordinate,
    date?: string,
  ): Promise<PointInspection>;
}
