/**
 * Fictional demo farmland listings for the Discovery browser.
 * Every parcel is invented — no real properties, prices, or sellers.
 * The UI must label these as demo data.
 */

export type DemoListing = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  acres: number;
  priceUsd: number;
  description: string;
};

export const DEMO_LISTINGS_LABEL = "Fictional demo listings — not real property.";

export const demoListings: DemoListing[] = [
  {
    id: "demo-field-01",
    name: "Demo Field 01",
    latitude: 41.583,
    longitude: -93.717,
    acres: 86,
    priceUsd: 770_000,
    description:
      "The original demo quarter — level, loamy, and already wired into the Field Info workspace.",
  },
  {
    id: "sweetwater-loess",
    name: "Sweetwater Loess Rise",
    latitude: 42.04,
    longitude: -95.88,
    acres: 154,
    priceUsd: 1_340_000,
    description:
      "Rolling loess with terraces that hold their lines. Drinks spring rain, drains summer storms.",
  },
  {
    id: "longfurrow-flats",
    name: "Longfurrow Flats",
    latitude: 40.12,
    longitude: -89.42,
    acres: 240,
    priceUsd: 2_560_000,
    description: "Table-flat prairie loam with tile every forty feet. Plant straight, harvest straighter.",
  },
  {
    id: "crooked-creek",
    name: "Crooked Creek Bottoms",
    latitude: 41.21,
    longitude: -96.93,
    acres: 118,
    priceUsd: 890_000,
    description: "Bottomland along a lazy creek. Rich dirt, with the occasional wet-spring opinion.",
  },
  {
    id: "red-hollow",
    name: "Red Hollow Terraces",
    latitude: 40.31,
    longitude: -94.87,
    acres: 97,
    priceUsd: 610_000,
    description: "Terraced claypan hills that reward patience and cover crops.",
  },
  {
    id: "dry-fork",
    name: "Dry Fork Quarter",
    latitude: 38.48,
    longitude: -100.93,
    acres: 160,
    priceUsd: 560_000,
    description: "High-plains wheat ground. Thin rain, big sky, honest yields in a good year.",
  },
  {
    id: "cedar-shelf",
    name: "Cedar Shelf Orchard Ground",
    latitude: 44.63,
    longitude: -86.19,
    acres: 62,
    priceUsd: 740_000,
    description: "Lake-tempered slope that fruit trees take a shine to. Late frosts mostly miss it.",
  },
  {
    id: "muleshoe-bench",
    name: "Muleshoe Bench",
    latitude: 34.23,
    longitude: -102.72,
    acres: 320,
    priceUsd: 990_000,
    description: "Panhandle bench with pivot points in place. Water rights do the heavy lifting.",
  },
  {
    id: "tamarack-peat",
    name: "Tamarack Peat Fields",
    latitude: 47.03,
    longitude: -95.85,
    acres: 140,
    priceUsd: 620_000,
    description: "Black peat that grows anything green, once it thaws.",
  },
  {
    id: "hardscrabble-forty",
    name: "Hardscrabble Forty",
    latitude: 44.28,
    longitude: -72.81,
    acres: 40,
    priceUsd: 380_000,
    description: "A stubborn New England forty: stone walls, sugar maples, and soil with character.",
  },
];
