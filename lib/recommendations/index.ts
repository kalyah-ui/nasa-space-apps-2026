import type { CompositeScore, ScoredComponent } from "../scoring";

export interface CropCandidate {
  id: string;
  name: string;
  family: string;
  suitability: CompositeScore;
}

export interface CropRecommendation {
  rank: number;
  cropId: string;
  cropName: string;
  family: string;
  score: number;
  coveragePct: number;
  missingComponents: string[];
  components: ScoredComponent[];
}

export interface RotationRecommendation {
  cropIds: string[];
  cropNames: string[];
  averageSuitabilityScore: number;
  coveragePct: number;
  rationale: string;
}

export interface CropRecommendationResult {
  recommendations: CropRecommendation[];
  unscoredCropIds: string[];
}

export interface RotationCropInput {
  name: string;
  family: string;
}

export interface PlannedRotationCrop extends RotationCropInput {
  year: number;
  isCurrent: boolean;
}

export const cropFamilyOptions = [
  { value: "Poaceae", label: "Grass family (Poaceae)" },
  { value: "Fabaceae", label: "Legume family (Fabaceae)" },
  { value: "Brassicaceae", label: "Mustard family (Brassicaceae)" },
  { value: "Solanaceae", label: "Nightshade family (Solanaceae)" },
  { value: "Asteraceae", label: "Sunflower family (Asteraceae)" },
  { value: "Amaranthaceae", label: "Amaranth family (Amaranthaceae)" },
  { value: "Cucurbitaceae", label: "Gourd family (Cucurbitaceae)" },
  { value: "Apiaceae", label: "Carrot family (Apiaceae)" },
  { value: "Amaryllidaceae", label: "Onion family (Amaryllidaceae)" },
  { value: "Linaceae", label: "Flax family (Linaceae)" },
  { value: "Polygonaceae", label: "Buckwheat family (Polygonaceae)" },
  { value: "Rosaceae", label: "Rose family (Rosaceae)" },
  { value: "Cannabaceae", label: "Hemp family (Cannabaceae)" },
  { value: "Other", label: "Other / not listed" },
] as const;

const cropNameFamilies: Record<string, string> = {
  corn: "Poaceae",
  maize: "Poaceae",
  "sweet corn": "Poaceae",
  wheat: "Poaceae",
  barley: "Poaceae",
  oat: "Poaceae",
  oats: "Poaceae",
  rye: "Poaceae",
  rice: "Poaceae",
  sorghum: "Poaceae",
  millet: "Poaceae",
  triticale: "Poaceae",
  soybean: "Fabaceae",
  soybeans: "Fabaceae",
  soy: "Fabaceae",
  bean: "Fabaceae",
  beans: "Fabaceae",
  "dry bean": "Fabaceae",
  pea: "Fabaceae",
  peas: "Fabaceae",
  lentil: "Fabaceae",
  lentils: "Fabaceae",
  chickpea: "Fabaceae",
  chickpeas: "Fabaceae",
  alfalfa: "Fabaceae",
  clover: "Fabaceae",
  canola: "Brassicaceae",
  rapeseed: "Brassicaceae",
  mustard: "Brassicaceae",
  cabbage: "Brassicaceae",
  broccoli: "Brassicaceae",
  cauliflower: "Brassicaceae",
  kale: "Brassicaceae",
  radish: "Brassicaceae",
  turnip: "Brassicaceae",
  potato: "Solanaceae",
  tomato: "Solanaceae",
  pepper: "Solanaceae",
  eggplant: "Solanaceae",
  sunflower: "Asteraceae",
  lettuce: "Asteraceae",
  chicory: "Asteraceae",
  "sugar beet": "Amaranthaceae",
  beet: "Amaranthaceae",
  spinach: "Amaranthaceae",
  quinoa: "Amaranthaceae",
  cucumber: "Cucurbitaceae",
  squash: "Cucurbitaceae",
  pumpkin: "Cucurbitaceae",
  pumpkins: "Cucurbitaceae",
  melon: "Cucurbitaceae",
  watermelon: "Cucurbitaceae",
  carrot: "Apiaceae",
  celery: "Apiaceae",
  parsley: "Apiaceae",
  onion: "Amaryllidaceae",
  garlic: "Amaryllidaceae",
  leek: "Amaryllidaceae",
  flax: "Linaceae",
  linseed: "Linaceae",
  buckwheat: "Polygonaceae",
  strawberry: "Rosaceae",
  peach: "Rosaceae",
  peaches: "Rosaceae",
  apple: "Rosaceae",
  hemp: "Cannabaceae",
};

export function inferCropFamily(cropName: string): string | null {
  const normalizedName = cropName.trim().toLowerCase().replace(/\s+/g, " ");
  const directMatch = cropNameFamilies[normalizedName];
  if (directMatch) return directMatch;

  const singularCandidates = normalizedName.endsWith("ies")
    ? [`${normalizedName.slice(0, -3)}y`]
    : normalizedName.endsWith("es")
      ? [normalizedName.slice(0, -2), normalizedName.slice(0, -1)]
      : normalizedName.endsWith("s")
        ? [normalizedName.slice(0, -1)]
        : [];

  for (const candidate of singularCandidates) {
    const family = cropNameFamilies[candidate];
    if (family) return family;
  }

  return null;
}

type ScoredCropCandidate = CropCandidate & {
  suitability: CompositeScore & { score: number };
};

function hasSuitabilityScore(crop: CropCandidate): crop is ScoredCropCandidate {
  return crop.suitability.score !== null;
}

function compareCrops(a: ScoredCropCandidate, b: ScoredCropCandidate): number {
  return b.suitability.score - a.suitability.score || a.id.localeCompare(b.id);
}

function familyKey(family: string): string {
  return family.trim().toLowerCase();
}

export function rankCropRecommendations(crops: CropCandidate[]): CropRecommendationResult {
  const scored = crops
    .filter(hasSuitabilityScore)
    .sort(compareCrops);

  return {
    recommendations: scored.map((crop, index) => ({
      rank: index + 1,
      cropId: crop.id,
      cropName: crop.name,
      family: crop.family,
      score: crop.suitability.score,
      coveragePct: crop.suitability.coveragePct,
      missingComponents: crop.suitability.missingComponents,
      components: crop.suitability.components,
    })),
    unscoredCropIds: crops
      .filter((crop) => crop.suitability.score === null)
      .map((crop) => crop.id),
  };
}

export function recommendCropRotations(
  crops: CropCandidate[],
  years: number,
  limit = 3,
): RotationRecommendation[] {
  if (!Number.isInteger(years) || years < 2) {
    throw new RangeError("Rotation length must be an integer of at least two years.");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Rotation limit must be a positive integer.");
  }

  const rankedCrops = crops
    .filter(hasSuitabilityScore)
    .filter((crop) => crop.family.trim().length > 0)
    .sort(compareCrops);
  const recommendations = new Map<string, RotationRecommendation>();

  for (const firstCrop of rankedCrops) {
    const sequence = [firstCrop];

    while (sequence.length < years) {
      const previousFamily = familyKey(sequence[sequence.length - 1].family);
      const nextCrop = rankedCrops.find((crop) => familyKey(crop.family) !== previousFamily);
      if (!nextCrop) break;
      sequence.push(nextCrop);
    }

    if (sequence.length !== years) continue;

    const cropIds = sequence.map((crop) => crop.id);
    const key = cropIds.join("|");
    if (recommendations.has(key)) continue;

    const averageScore = sequence.reduce((sum, crop) => sum + crop.suitability.score, 0) / years;
    const coveragePct =
      sequence.reduce((sum, crop) => sum + crop.suitability.coveragePct, 0) / years;

    recommendations.set(key, {
      cropIds,
      cropNames: sequence.map((crop) => crop.name),
      averageSuitabilityScore: Math.round(averageScore * 10) / 10,
      coveragePct: Math.round(coveragePct * 10) / 10,
      rationale: "Greedy suitability ranking; avoids planting the same crop family in consecutive years.",
    });
  }

  return [...recommendations.values()]
    .sort(
      (a, b) =>
        b.averageSuitabilityScore - a.averageSuitabilityScore ||
        a.cropIds.join("|").localeCompare(b.cropIds.join("|")),
    )
    .slice(0, limit);
}

export function buildCropRotationPlan(
  currentCrop: RotationCropInput,
  desiredCrops: RotationCropInput[],
  years: number,
): PlannedRotationCrop[] | null {
  if (!Number.isInteger(years) || years < 2 || years > 12) {
    throw new RangeError("Rotation length must be an integer from two to twelve years.");
  }

  const currentName = currentCrop.name.trim();
  const currentFamily = currentCrop.family.trim();
  if (!currentName || !currentFamily) {
    throw new RangeError("Enter the current crop and its family.");
  }

  const candidates = desiredCrops.map((crop) => ({
    name: crop.name.trim(),
    family: crop.family.trim(),
  }));
  if (candidates.length === 0 || candidates.some((crop) => !crop.name || !crop.family)) {
    throw new RangeError("Enter a name and family for each crop you want to plant.");
  }

  const sequence: RotationCropInput[] = [];
  const usedCandidates = new Set<number>();

  function fillSequence(previousFamily: string, remainingYears: number): boolean {
    if (remainingYears === 0) return true;

    for (const allowRepeating of [false, true]) {
      for (const [candidateIndex, candidate] of candidates.entries()) {
        if (familyKey(candidate.family) === previousFamily) continue;
        if (!allowRepeating && usedCandidates.has(candidateIndex)) continue;
        sequence.push(candidate);
        const wasUsed = usedCandidates.has(candidateIndex);
        usedCandidates.add(candidateIndex);
        if (fillSequence(familyKey(candidate.family), remainingYears - 1)) return true;
        sequence.pop();
        if (!wasUsed) usedCandidates.delete(candidateIndex);
      }
    }
    return false;
  }

  if (!fillSequence(familyKey(currentFamily), years - 1)) return null;

  return [
    { year: 1, name: currentName, family: currentFamily, isCurrent: true },
    ...sequence.map((crop, index) => ({ ...crop, year: index + 2, isCurrent: false })),
  ];
}
