/**
 * Fictional demo farmland listings for the Discovery browser.
 * Every parcel is invented — no real properties, prices, or sellers.
 * The UI must label these as demo data.
 *
 * Locations are plausible coordinates in real Canadian farm regions. Prices
 * are derived from each province's published value per acre of farm land and
 * buildings (Statistics Canada table 32-10-0047-01, reference year 2025 — see
 * provincial-land-values.ts), times a per-parcel multiplier reflecting the
 * listing's story (soil quality, region, improvements). Each listing's price
 * comment records its multiplier. Multipliers stay in a modest 0.55×–2× band
 * so comparisons against the provincial average remain plausible; genuinely
 * premium micro-regions (e.g. Okanagan orchard land) are deliberately kept at
 * the low end of their real-world range.
 */

export type Province = "AB" | "BC" | "MB" | "ON" | "PE" | "QC" | "SK";

export type DemoListing = {
  id: string;
  name: string;
  province: Province;
  latitude: number;
  longitude: number;
  acres: number;
  priceCad: number;
  description: string;
};

export const DEMO_LISTINGS_LABEL = "Fictional demo listings — not real property.";

export const demoListings: DemoListing[] = [
  {
    id: "demo-field-01",
    name: "Demo Field 01",
    province: "ON",
    latitude: 45.307,
    longitude: -76.298,
    acres: 86,
    // ≈0.55× ON avg ($21,073/ac): Ottawa Valley trades well below the
    // southern-Ontario-driven provincial average.
    priceCad: 995_000,
    description:
      "The original demo parcel in the Ottawa Valley — the same ground the Field Info workspace maps.",
  },
  {
    id: "maitland-loam",
    name: "Maitland Loam Flats",
    province: "ON",
    latitude: 43.55,
    longitude: -81.4,
    acres: 180,
    // ≈1.25× ON avg: prime, tiled Huron County loam.
    priceCad: 4_740_000,
    description:
      "Huron County loam that grows corn like it's showing off. Systematically tiled, patiently limed.",
  },
  {
    id: "norfolk-sand-block",
    name: "Norfolk Sand Block",
    province: "ON",
    latitude: 42.84,
    longitude: -80.42,
    acres: 95,
    // ≈0.9× ON avg: lighter sand-plain ground needing irrigation.
    priceCad: 1_800_000,
    description:
      "Sand-plain ground south of the 403. Warms early, drains fast, and asks for irrigation in August.",
  },
  {
    id: "red-river-gumbo",
    name: "Red River Gumbo Quarter",
    province: "MB",
    latitude: 49.35,
    longitude: -97.37,
    acres: 160,
    // ≈1.3× MB avg ($4,166/ac): Red River Valley is Manitoba's best ground.
    priceCad: 865_000,
    description:
      "Red River Valley clay that holds water like a grudge in May and grows a crop like nowhere else by July.",
  },
  {
    id: "wheatline-half",
    name: "Wheatline Half-Section",
    province: "SK",
    latitude: 50.53,
    longitude: -103.65,
    acres: 320,
    // ≈1.15× SK avg ($2,943/ac): productive Regina Plains clay.
    priceCad: 1_080_000,
    description:
      "Regina Plains heavy clay. Durum, canola, and a horizon with no opinions.",
  },
  {
    id: "sagebrush-half",
    name: "Sagebrush Half-Section",
    province: "SK",
    latitude: 50.28,
    longitude: -107.8,
    acres: 320,
    // ≈0.8× SK avg: dry brown-soil zone.
    priceCad: 755_000,
    description:
      "Brown-soil wheat ground near Swift Current. Thin rain, wide sky, honest yields in a good year.",
  },
  {
    id: "parkland-black-loam",
    name: "Parkland Black Loam",
    province: "AB",
    latitude: 52.47,
    longitude: -113.73,
    acres: 240,
    // ≈1.2× AB avg ($4,367/ac): black-soil parkland cropland.
    priceCad: 1_260_000,
    description:
      "Central Alberta black soil in the parkland belt. Barley, canola, and chinook-tempered winters.",
  },
  {
    id: "sunstone-bench",
    name: "Sunstone Orchard Bench",
    province: "BC",
    latitude: 49.18,
    longitude: -119.55,
    acres: 38,
    // ≈2× BC avg ($10,577/ac): established orchard with water rights. Real
    // South Okanagan orchard land can run far higher, but the premium is kept
    // modest so the provincial comparison stays meaningful.
    priceCad: 805_000,
    description:
      "South Okanagan bench with water rights and a lake-moderated frost season. Cherries take a shine to it.",
  },
  {
    id: "monteregie-rang",
    name: "Montérégie Rang Lot",
    province: "QC",
    latitude: 45.62,
    longitude: -72.95,
    acres: 120,
    // ≈1.25× QC avg ($11,131/ac): drained Montérégie corn ground.
    priceCad: 1_670_000,
    description:
      "A long, narrow rang lot in Québec's best corn country. Drained, ditched, and dependable.",
  },
  {
    id: "island-red-dirt",
    name: "Island Red Dirt Farm",
    province: "PE",
    latitude: 46.43,
    longitude: -63.65,
    acres: 140,
    // ≈0.95× PE avg ($6,889/ac): solid, unremarkable potato ground.
    priceCad: 915_000,
    description:
      "PEI's famous red sandstone soil. Potatoes love it; the rust stains on the pickup are included.",
  },
];
