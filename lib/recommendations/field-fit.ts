export interface FieldSoilContext {
  sandPct: number | null;
  siltPct: number | null;
  clayPct: number | null;
  phCacl2: number | null;
  coveragePct: number;
}

export interface CropFieldFit {
  cropName: string;
  score: number | null;
  coveragePct: number;
  verdict: "Good soil match" | "Review soil fit" | "Soil mismatch" | "Not rated";
  explanation: string;
}

interface CropSoilProfile {
  ph: [number, number];
  sand: [number, number];
  clay: [number, number];
}

const cropSoilProfiles: Record<string, CropSoilProfile> = {
  corn: { ph: [5.8, 7.0], sand: [15, 70], clay: [10, 40] },
  maize: { ph: [5.8, 7.0], sand: [15, 70], clay: [10, 40] },
  "sweet corn": { ph: [5.8, 7.0], sand: [15, 70], clay: [10, 40] },
  soybean: { ph: [6.0, 7.5], sand: [10, 75], clay: [5, 40] },
  soybeans: { ph: [6.0, 7.5], sand: [10, 75], clay: [5, 40] },
  soy: { ph: [6.0, 7.5], sand: [10, 75], clay: [5, 40] },
  wheat: { ph: [5.5, 7.5], sand: [10, 75], clay: [5, 45] },
  barley: { ph: [5.5, 7.5], sand: [10, 75], clay: [5, 45] },
  oats: { ph: [5.0, 7.5], sand: [10, 75], clay: [5, 45] },
  canola: { ph: [5.5, 7.5], sand: [15, 75], clay: [5, 40] },
  rapeseed: { ph: [5.5, 7.5], sand: [15, 75], clay: [5, 40] },
  strawberry: { ph: [5.5, 6.5], sand: [30, 70], clay: [5, 30] },
  strawberries: { ph: [5.5, 6.5], sand: [30, 70], clay: [5, 30] },
  potato: { ph: [4.8, 6.5], sand: [35, 85], clay: [0, 25] },
  potatoes: { ph: [4.8, 6.5], sand: [35, 85], clay: [0, 25] },
  tomato: { ph: [5.5, 7.0], sand: [20, 70], clay: [5, 35] },
  tomatoes: { ph: [5.5, 7.0], sand: [20, 70], clay: [5, 35] },
  "dry bean": { ph: [6.0, 7.5], sand: [15, 70], clay: [5, 35] },
};

function normalizedName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreRange(value: number, range: [number, number], margin: number): number {
  if (value >= range[0] && value <= range[1]) return 100;
  const distance = value < range[0] ? range[0] - value : value - range[1];
  return Math.max(0, Math.round(100 - (distance / margin) * 100));
}

export function summarizeFieldSoil(landscapes: Array<{
  field_overlap_pct: number;
  components: Array<{
    composition_pct: number;
    surface_horizon: {
      sand_pct: number | null;
        silt_pct: number | null;
      clay_pct: number | null;
      ph_cacl2: number | null;
    } | null;
  }>;
}>): FieldSoilContext {
  let mappedAreaPct = 0;
  let sandWeight = 0;
  let sandTotal = 0;
  let siltWeight = 0;
  let siltTotal = 0;
  let clayWeight = 0;
  let clayTotal = 0;
  let phWeight = 0;
  let phTotal = 0;

  for (const landscape of landscapes) {
    mappedAreaPct += landscape.field_overlap_pct;
    for (const component of landscape.components) {
      const weight = landscape.field_overlap_pct * component.composition_pct / 100;
      const horizon = component.surface_horizon;
      if (!horizon) continue;
      if (horizon.sand_pct !== null) {
        sandWeight += weight;
        sandTotal += horizon.sand_pct * weight;
      }
      if (horizon.silt_pct !== null) {
        siltWeight += weight;
        siltTotal += horizon.silt_pct * weight;
      }
      if (horizon.clay_pct !== null) {
        clayWeight += weight;
        clayTotal += horizon.clay_pct * weight;
      }
      if (horizon.ph_cacl2 !== null) {
        phWeight += weight;
        phTotal += horizon.ph_cacl2 * weight;
      }
    }
  }

  const availableWeights = [sandWeight, clayWeight, phWeight].filter((weight) => weight > 0);
  return {
    sandPct: sandWeight ? sandTotal / sandWeight : null,
    siltPct: siltWeight ? siltTotal / siltWeight : null,
    clayPct: clayWeight ? clayTotal / clayWeight : null,
    phCacl2: phWeight ? phTotal / phWeight : null,
    coveragePct: Math.min(100, availableWeights.length / 3 * Math.min(100, mappedAreaPct)),
  };
}

export function screenCropFieldFit(cropName: string, soil: FieldSoilContext): CropFieldFit {
  const profile = cropSoilProfiles[normalizedName(cropName)];
  if (!profile) {
    return {
      cropName,
      score: null,
      coveragePct: 0,
      verdict: "Not rated",
      explanation: "A soil tolerance profile is not available for this crop yet.",
    };
  }

  const criteria: number[] = [];
  if (soil.phCacl2 !== null) criteria.push(scoreRange(soil.phCacl2, profile.ph, 1.5));
  if (soil.sandPct !== null) criteria.push(scoreRange(soil.sandPct, profile.sand, 25));
  if (soil.clayPct !== null) criteria.push(scoreRange(soil.clayPct, profile.clay, 20));

  if (criteria.length === 0) {
    return {
      cropName,
      score: null,
      coveragePct: 0,
      verdict: "Not rated",
      explanation: "Mapped pH and texture values are not available for this field.",
    };
  }

  const score = Math.round(criteria.reduce((sum, value) => sum + value, 0) / criteria.length);
  const verdict = score >= 80 ? "Good soil match" : score >= 55 ? "Review soil fit" : "Soil mismatch";
  return {
    cropName,
    score,
    coveragePct: Math.round(criteria.length / 3 * soil.coveragePct),
    verdict,
    explanation: `Screened against mapped surface pH${soil.sandPct !== null || soil.clayPct !== null ? " and texture" : ""}; drainage, climate, pests, and crop-specific management are not included.`,
  };
}
