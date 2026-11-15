export type FieldPosition = [longitude: number, latitude: number];

export type FieldGeometry =
  | { type: "Polygon"; coordinates: FieldPosition[][] }
  | { type: "MultiPolygon"; coordinates: FieldPosition[][][] };

export type StoredFieldProperties = {
  name: string;
  areaHectares: number;
};

export type StoredFieldFeature = {
  type: "Feature";
  id: string;
  properties: StoredFieldProperties;
  geometry: FieldGeometry;
};

export type StoredFieldCollection = {
  type: "FeatureCollection";
  features: StoredFieldFeature[];
};
