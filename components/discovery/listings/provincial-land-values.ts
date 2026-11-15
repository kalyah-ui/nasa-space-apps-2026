import type { Province } from "./demo-listings";

/**
 * Provincial farmland values, CAD per acre.
 *
 * Real published figures from Statistics Canada table 32-10-0047-01,
 * "Value per acre of farm land and buildings at July 1". Retrieved from the
 * StatCan Web Data Service (getCubeMetadata + getDataFromCubePidCoordAndLatestNPeriods,
 * productId 32100047) on 2026-11-15; the 2025 reference-year figures were
 * released 2026-05-27. Values are checked in as a static snapshot because the
 * series updates once a year and the WDS is not meant to be an app data feed.
 *
 * To refresh: re-run the same WDS calls and update the numbers, referenceYear,
 * and retrieval metadata together. Never edit a value by hand without a
 * matching published figure.
 */

export type ProvincialLandValue = {
  provinceName: string;
  /** Value per acre of farm land and buildings, Canadian dollars. */
  valuePerAcreCad: number;
  referenceYear: number;
};

export const LAND_VALUE_SOURCE = {
  publisher: "Statistics Canada",
  table: "32-10-0047-01",
  title: "Value per acre of farm land and buildings at July 1",
  url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210004701",
  retrievedOn: "2026-11-15",
  releasedOn: "2026-05-27",
} as const;

export const provincialLandValues: Record<Province, ProvincialLandValue> = {
  AB: { provinceName: "Alberta", valuePerAcreCad: 4367, referenceYear: 2025 },
  BC: { provinceName: "British Columbia", valuePerAcreCad: 10577, referenceYear: 2025 },
  MB: { provinceName: "Manitoba", valuePerAcreCad: 4166, referenceYear: 2025 },
  ON: { provinceName: "Ontario", valuePerAcreCad: 21073, referenceYear: 2025 },
  PE: { provinceName: "Prince Edward Island", valuePerAcreCad: 6889, referenceYear: 2025 },
  QC: { provinceName: "Quebec", valuePerAcreCad: 11131, referenceYear: 2025 },
  SK: { provinceName: "Saskatchewan", valuePerAcreCad: 2943, referenceYear: 2025 },
};

/**
 * Null-safe lookup so UI code degrades gracefully if a listing ever carries a
 * province without a published value (e.g. a territory, or a gap in a future
 * refresh).
 */
export function provincialLandValue(province: Province): ProvincialLandValue | null {
  return provincialLandValues[province] ?? null;
}
