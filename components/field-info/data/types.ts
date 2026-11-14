export type Coordinate = readonly [longitude: number, latitude: number];

export type FieldGeometry = {
  type: "Polygon";
  coordinates: Coordinate[][];
};

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
  | "reci"
  | "mcari"
  | "pri"
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

export interface DataProvider {
  getField(fieldId: string): Promise<FieldSpec | null>;
  listLayers(fieldId: string): Promise<LayerSpec[]>;
  listLayerDates(fieldId: string, layerId: LayerId): Promise<string[]>;
  getLayerData(fieldId: string, layerId: LayerId, date?: string): Promise<LayerData>;
  inspectPoint(
    fieldId: string,
    coordinates: Coordinate,
    date?: string,
  ): Promise<PointInspection>;
}
