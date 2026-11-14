export type FarmDimension = "soil" | "water" | "flood" | "climate";

export interface ScoreComponentInput {
  score: number | null;
  weight: number;
  coveragePct?: number;
  source?: string;
}

export interface WeightedScoreComponent extends ScoreComponentInput {
  key: string;
}

export interface ScoredComponent extends WeightedScoreComponent {
  coveragePct: number;
}

export interface CompositeScore {
  score: number | null;
  coveragePct: number;
  components: ScoredComponent[];
  missingComponents: string[];
}

export type FarmDimensions = Record<FarmDimension, ScoreComponentInput>;

type AvailableScoreComponent = ScoredComponent & { score: number };

const farmDimensions: FarmDimension[] = ["soil", "water", "flood", "climate"];

function assertPercentage(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be a finite number from 0 to 100.`);
  }
}

export function calculateWeightedScore(components: WeightedScoreComponent[]): CompositeScore {
  if (components.length === 0) {
    throw new RangeError("At least one score component is required.");
  }

  const scoredComponents = components.map((component) => {
    if (!Number.isFinite(component.weight) || component.weight < 0) {
      throw new RangeError(`Weight for "${component.key}" must be a finite, non-negative number.`);
    }

    if (component.score !== null) {
      assertPercentage(`Score for "${component.key}"`, component.score);
    }

    const suppliedCoveragePct = component.coveragePct ?? (component.score === null ? 0 : 100);
    assertPercentage(`Coverage for "${component.key}"`, suppliedCoveragePct);
    const coveragePct = component.score === null ? 0 : suppliedCoveragePct;

    return { ...component, coveragePct };
  });

  const totalWeight = scoredComponents.reduce((sum, component) => sum + component.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new RangeError("At least one score component must have a positive weight.");
  }

  const availableComponents = scoredComponents.filter(
    (component): component is AvailableScoreComponent =>
      component.score !== null && component.weight > 0,
  );
  const availableWeight = availableComponents.reduce((sum, component) => sum + component.weight, 0);
  const weightedScore = availableComponents.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  );
  const weightedCoverage = scoredComponents.reduce(
    (sum, component) => sum + component.coveragePct * component.weight,
    0,
  );

  return {
    score:
      availableWeight === 0
        ? null
        : Math.round((weightedScore / availableWeight) * 10) / 10,
    coveragePct: Math.round((weightedCoverage / totalWeight) * 10) / 10,
    components: scoredComponents,
    missingComponents: scoredComponents
      .filter((component) => component.score === null && component.weight > 0)
      .map((component) => component.key),
  };
}

function dimensionsToComponents(dimensions: FarmDimensions): WeightedScoreComponent[] {
  return farmDimensions.map((key) => ({
    key,
    ...dimensions[key],
  }));
}

export function calculateFarmScore(dimensions: FarmDimensions): CompositeScore {
  return calculateWeightedScore(dimensionsToComponents(dimensions));
}

export function calculateCropSuitabilityScore(dimensions: FarmDimensions): CompositeScore {
  return calculateWeightedScore(dimensionsToComponents(dimensions));
}

export function calculateFutureFarmScore(dimensions: FarmDimensions): CompositeScore {
  return calculateWeightedScore(dimensionsToComponents(dimensions));
}
