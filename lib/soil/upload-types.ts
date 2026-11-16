import type { FieldGeometry } from "@/lib/fields/types";
import type { SoilCropId, SoilSuitabilityRating } from "./types";

export type SoilSamplingScope = "whole-field-composite" | "individual-samples";
export type SoilCsvField =
  | "sampleId"
  | "sampleDate"
  | "latitude"
  | "longitude"
  | "depthTop"
  | "depthBottom"
  | "ph"
  | "phosphorus"
  | "potassium"
  | "organicMatter"
  | "sand"
  | "silt"
  | "clay";

export type SoilCsvMapping = Partial<Record<SoilCsvField, string>> & {
  depthUnit: "cm";
  phosphorusUnit: "mg/kg" | "ppm";
  potassiumUnit: "mg/kg" | "ppm";
  organicMatterUnit: "%";
  textureUnit: "%";
  phMethod: string | null;
};

export type SoilMeasurement = {
  value: number;
  unit: string;
  method: string | null;
};

export type SoilSampleRecord = {
  rowNumber: number;
  sampleId: string;
  sampleDate: string | null;
  coordinates: [longitude: number, latitude: number] | null;
  depthTopCm: number | null;
  depthBottomCm: number | null;
  ph: SoilMeasurement | null;
  phosphorus: SoilMeasurement | null;
  potassium: SoilMeasurement | null;
  organicMatter: SoilMeasurement | null;
  sand: SoilMeasurement | null;
  silt: SoilMeasurement | null;
  clay: SoilMeasurement | null;
};

export type SoilUploadAssessment = {
  crop: SoilCropId;
  rating: SoilSuitabilityRating;
  limitingFactors: string[];
  dataGaps: string[];
  informedBy: string[];
  uncertainty: string;
};

export type SoilTestUpload = {
  uploadId: string;
  ownerIdHash: string;
  fieldId: string;
  fieldName: string;
  fieldBoundary: FieldGeometry;
  address: string | null;
  originalFileName: string;
  uploadedAt: string;
  samplingScope: SoilSamplingScope;
  mapping: SoilCsvMapping;
  samples: SoilSampleRecord[];
  assessment: SoilUploadAssessment | null;
};

export type SoilTestCollection = {
  fieldId: string;
  uploads: SoilTestUpload[];
  authentication: "signed-anonymous-cookie";
  ownershipNote: string;
};

export type SoilUploadValidationError = {
  rowNumber: number | null;
  field: string | null;
  message: string;
};
