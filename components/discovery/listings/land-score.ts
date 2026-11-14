import type { DemoListing } from "./demo-listings";

/**
 * Illustrative land score, 0–100. A deterministic placeholder heuristic so the
 * UI has something to sort, filter, and compare on — NOT an agronomic method.
 * The scoring owner defines the real method; until then the UI labels this
 * value "Estimate".
 */

export const LAND_SCORE_NOTE =
  "Illustrative demo score from a placeholder heuristic (latitude, longitude, acreage). The real scoring method is still to be defined.";

export function landScore(listing: DemoListing): number {
  // Corn-belt latitudes score best in this toy heuristic.
  const latitudeFit = 100 - Math.min(80, Math.abs(listing.latitude - 42) * 9);
  // Rough east-wetter / west-drier proxy.
  const moistureProxy = 100 - Math.min(70, Math.max(0, (-listing.longitude - 88) * 2.2));
  // Mild economies-of-scale bump.
  const sizeFactor = Math.min(100, 40 + Math.sqrt(listing.acres) * 5);

  const score = 0.45 * latitudeFit + 0.35 * moistureProxy + 0.2 * sizeFactor;
  return Math.round(Math.min(95, Math.max(8, score)));
}
