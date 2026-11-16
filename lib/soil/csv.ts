import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { MultiPolygon, Polygon } from "geojson";
import type { StoredFieldFeature } from "@/lib/fields/types";
import type { SoilCsvMapping, SoilMeasurement, SoilSampleRecord, SoilSamplingScope, SoilUploadValidationError } from "./upload-types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value.trim()); value = ""; }
    else if (character === "\n") { row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else if (character !== "\r") value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  return rows;
}

function readNumber(row: Record<string, string>, column: string | undefined, rowNumber: number, field: string, errors: SoilUploadValidationError[]) {
  if (!column || !row[column]?.trim()) return null;
  const value = Number(row[column]);
  if (!Number.isFinite(value)) { errors.push({ rowNumber, field, message: field + " must be numeric." }); return null; }
  return value;
}

function measurement(value: number | null, unit: string, method: string | null = null): SoilMeasurement | null {
  return value === null ? null : { value, unit, method };
}

export function validateSoilCsv(text: string, mapping: SoilCsvMapping, scope: SoilSamplingScope, field: StoredFieldFeature) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { samples: [], errors: [{ rowNumber: null, field: null, message: "The CSV needs a header and at least one data row." }] };
  const headers = rows[0].map((header) => header.trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) return { samples: [], errors: [{ rowNumber: null, field: null, message: "CSV headers must be non-empty and unique." }] };
  if (!mapping.ph && !mapping.phosphorus && !mapping.potassium && !mapping.organicMatter && !mapping.sand && !mapping.silt && !mapping.clay) return { samples: [], errors: [{ rowNumber: null, field: null, message: "Map at least one soil measurement column." }] };
  const errors: SoilUploadValidationError[] = [];
  const polygon = { type: "Feature" as const, properties: {}, geometry: field.geometry as Polygon | MultiPolygon };
  const samples = rows.slice(1).map((values, index): SoilSampleRecord => {
    const rowNumber = index + 2;
    const row = Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex] ?? ""]));
    const latitude = readNumber(row, mapping.latitude, rowNumber, "latitude", errors);
    const longitude = readNumber(row, mapping.longitude, rowNumber, "longitude", errors);
    let coordinates: [number, number] | null = null;
    if ((latitude === null) !== (longitude === null)) errors.push({ rowNumber, field: "coordinates", message: "Latitude and longitude must be supplied together." });
    else if (latitude !== null && longitude !== null) {
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) errors.push({ rowNumber, field: "coordinates", message: "Coordinates are outside valid ranges." });
      else { coordinates = [longitude, latitude]; if (!booleanPointInPolygon(point(coordinates), polygon)) errors.push({ rowNumber, field: "coordinates", message: "Sample coordinates fall outside the selected field boundary." }); }
    }
    const depthTop = readNumber(row, mapping.depthTop, rowNumber, "depth top", errors);
    const depthBottom = readNumber(row, mapping.depthBottom, rowNumber, "depth bottom", errors);
    if (depthTop !== null && depthBottom !== null && (depthTop < 0 || depthBottom <= depthTop)) errors.push({ rowNumber, field: "depth", message: "Sampling depth must increase from a non-negative top depth." });
    const ph = readNumber(row, mapping.ph, rowNumber, "pH", errors);
    if (ph !== null && (ph < 0 || ph > 14)) errors.push({ rowNumber, field: "pH", message: "pH must be between 0 and 14." });
    const phosphorus = readNumber(row, mapping.phosphorus, rowNumber, "phosphorus", errors);
    const potassium = readNumber(row, mapping.potassium, rowNumber, "potassium", errors);
    const organicMatter = readNumber(row, mapping.organicMatter, rowNumber, "organic matter", errors);
    const sand = readNumber(row, mapping.sand, rowNumber, "sand", errors);
    const silt = readNumber(row, mapping.silt, rowNumber, "silt", errors);
    const clay = readNumber(row, mapping.clay, rowNumber, "clay", errors);
    for (const [name, candidate] of [["organic matter", organicMatter], ["sand", sand], ["silt", silt], ["clay", clay]] as const) if (candidate !== null && (candidate < 0 || candidate > 100)) errors.push({ rowNumber, field: name, message: name + " must be between 0 and 100%." });
    if (sand !== null && silt !== null && clay !== null && (sand + silt + clay < 95 || sand + silt + clay > 105)) errors.push({ rowNumber, field: "texture", message: "Sand, silt and clay should total approximately 100%." });
    const sampleDate = mapping.sampleDate && row[mapping.sampleDate]?.trim() ? row[mapping.sampleDate].trim() : null;
    if (sampleDate && Number.isNaN(Date.parse(sampleDate))) errors.push({ rowNumber, field: "sample date", message: "Sample date is not recognized." });
    return { rowNumber, sampleId: mapping.sampleId && row[mapping.sampleId]?.trim() ? row[mapping.sampleId].trim() : "Sample " + (index + 1), sampleDate, coordinates, depthTopCm: depthTop, depthBottomCm: depthBottom, ph: measurement(ph, "pH", mapping.phMethod), phosphorus: measurement(phosphorus, mapping.phosphorusUnit), potassium: measurement(potassium, mapping.potassiumUnit), organicMatter: measurement(organicMatter, mapping.organicMatterUnit), sand: measurement(sand, mapping.textureUnit), silt: measurement(silt, mapping.textureUnit), clay: measurement(clay, mapping.textureUnit) };
  });
  if (scope === "whole-field-composite" && samples.length > 1) errors.push({ rowNumber: null, field: "sampling scope", message: "A whole-field composite upload must contain one combined result row." });
  return { samples, errors };
}
