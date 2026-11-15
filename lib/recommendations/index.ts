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
