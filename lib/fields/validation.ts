import area from "@turf/area";
import booleanValid from "@turf/boolean-valid";
import kinks from "@turf/kinks";
import { feature } from "@turf/helpers";
import type { MultiPolygon, Polygon } from "geojson";
import type { FieldGeometry, FieldPosition } from "./types";

export class InvalidFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFieldError";
  }
}

function parsePosition(value: unknown): FieldPosition {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== "number" ||
    !Number.isFinite(value[0]) ||
    value[0] < -180 ||
    value[0] > 180 ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[1]) ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    throw new InvalidFieldError("Field boundaries contain an invalid coordinate.");
  }

  return [value[0], value[1]];
}

function parseRing(value: unknown): FieldPosition[] {
  if (!Array.isArray(value) || value.length < 3) {
    throw new InvalidFieldError("Each field ring needs at least three coordinates.");
  }

  const ring = value.map(parsePosition);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }

  if (ring.length < 4) {
    throw new InvalidFieldError("Each field ring needs at least three distinct points.");
  }

  return ring;
}

export function parseFieldGeometry(value: unknown): FieldGeometry {
  if (!value || typeof value !== "object") {
    throw new InvalidFieldError("A Polygon or MultiPolygon boundary is required.");
  }

  const geometry = value as { type?: unknown; coordinates?: unknown };
  let parsed: FieldGeometry;

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    parsed = {
      type: "Polygon",
      coordinates: geometry.coordinates.map(parseRing),
    };
  } else if (
    geometry.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates)
  ) {
    parsed = {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) => {
        if (!Array.isArray(polygon)) {
          throw new InvalidFieldError("The MultiPolygon boundary is invalid.");
        }
        return polygon.map(parseRing);
      }),
    };
  } else {
    throw new InvalidFieldError("Only Polygon and MultiPolygon fields are supported.");
  }

  const turfFeature = feature(parsed as Polygon | MultiPolygon);
  if (!booleanValid(turfFeature)) {
    throw new InvalidFieldError("The field polygon is not geometrically valid.");
  }
  if (kinks(turfFeature).features.length > 0) {
    throw new InvalidFieldError("The field polygon crosses itself.");
  }

  const areaHectares = area(turfFeature) / 10_000;
  if (!Number.isFinite(areaHectares) || areaHectares < 0.001) {
    throw new InvalidFieldError("The field polygon is too small.");
  }
  if (areaHectares > 1_000_000) {
    throw new InvalidFieldError("The field polygon is too large.");
  }

  return parsed;
}

export function validateFieldName(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidFieldError("A field name is required.");
  }

  const name = value.trim();
  if (!name) {
    throw new InvalidFieldError("A field name is required.");
  }
  if (name.length > 100) {
    throw new InvalidFieldError("Field names must be 100 characters or fewer.");
  }

  return name;
}

export function getAreaHectares(geometry: FieldGeometry): number {
  return Number(
    (area(feature(geometry as Polygon | MultiPolygon)) / 10_000).toFixed(2),
  );
}
