"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { classifyCrops, type CropClassification } from "@/lib/datasets/crops-client";
import {
  buildCropRotationPlan,
  cropFamilyOptions,
  inferCropFamily,
  type PlannedRotationCrop,
  type RotationCropInput,
} from "@/lib/recommendations";
import {
  screenCropFieldFit,
  type FieldSoilContext,
} from "@/lib/recommendations/field-fit";

interface DesiredCrop extends RotationCropInput {
  id: number;
  waterDemand: "lower" | "moderate" | "higher" | "unknown";
  waterDemandManual: boolean;
  expectedYield: string;
  expectedPrice: string;
  budgetIndex: string;
  customCost: string;
}

interface CropBudget {
  crop: string;
  practice: string;
  cost_cad_per_hectare: number;
  cost_category: string;
  publication_year: number;
  source_page: string;
  source_url: string;
}

interface RotationScenario {
  name: string;
  plan: PlannedRotationCrop[] | null;
  note: string;
  fieldFitScore: number | null;
  fieldFitCoveragePct: number;
  familyDiversityPct: number | null;
  familyCount: number;
  familyConflictCount: number;
  relativeWaterDemand: string | null;
  estimatedGrossRevenuePerHa: number | null;
  revenueCoveragePct: number;
  estimatedMarginPerHa: number | null;
}

type CropWithFamily = RotationCropInput & Pick<DesiredCrop, "waterDemand" | "expectedYield" | "expectedPrice" | "budgetIndex" | "customCost">;
type DesiredCropPatch = Partial<Omit<DesiredCrop, "id">>;

interface SeasonRow {
  id: number;
  year: number;
  cropName: string;
  plantingDate: string;
  harvestDate: string;
}

function familyLabel(family: string): string {
  return cropFamilyOptions.find((option) => option.value === family)?.label ?? family;
}

function cropNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchingBudgetCrops(name: string): string[] {
  const crop = cropNameKey(name);
  const aliases: Record<string, string[]> = {
    maize: ["corn"],
    soybean: ["soybeans"],
    soy: ["soybeans"],
    canola: ["spring canola"],
    wheat: ["spring wheat", "winter wheat"],
    oat: ["oats"],
    "black bean": ["black beans"],
    "coloured bean": ["coloured beans"],
    "colored bean": ["coloured beans"],
    "colored beans": ["coloured beans"],
    "white bean": ["coloured beans"],
    "white beans": ["coloured beans"],
  };
  return aliases[crop] ?? (crop ? [crop] : []);
}

function familySuggestionLabel(
  name: string,
  manualFamily: string,
  classification?: CropClassification,
): string {
  if (classification?.family_method === "gemini") return "Gemini suggestion · verify locally";
  if (classification?.family_method === "crop-reference") return "Crop reference suggestion";
  if (inferCropFamily(name)) return "Inferred from crop name";
  return manualFamily ? "Selected by you" : "Family suggestion unavailable";
}

export function CropRotationBuilder({
  fieldName,
  fieldSoil,
  stage,
  onBackToField,
  onEditCrops,
  onPlanReady,
  onPlanCleared,
}: {
  fieldName: string;
  fieldSoil: FieldSoilContext | null;
  /** Which wizard panel to render; "hidden" keeps state mounted without UI. */
  stage: "hidden" | "crops" | "results";
  onBackToField: () => void;
  onEditCrops: () => void;
  onPlanReady: () => void;
  onPlanCleared: () => void;
}) {
  const [currentCrop, setCurrentCrop] = useState<RotationCropInput>({ name: "", family: "" });
  const [desiredCrops, setDesiredCrops] = useState<DesiredCrop[]>([]);
  const [nextCropId, setNextCropId] = useState(1);
  const [rotationLength, setRotationLength] = useState("4");
  const [plan, setPlan] = useState<PlannedRotationCrop[] | null>(null);
  const [scenarios, setScenarios] = useState<RotationScenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [cropClassifications, setCropClassifications] = useState<Record<string, CropClassification>>({});
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<CropBudget[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const desiredCropNames = JSON.stringify([...new Set(desiredCrops.map((crop) => crop.name.trim()).filter((name) => name && name.length <= 120))].slice(0, 20));

  useEffect(() => {
    const names = JSON.parse(desiredCropNames) as string[];
    if (!names.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      classifyCrops(names, fieldSoil, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setCropClassifications((previous) => ({
            ...previous,
            ...Object.fromEntries(result.classifications.map((item) => [cropNameKey(item.crop_name), item])),
          }));
        })
        .catch(() => {});
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [desiredCropNames, fieldSoil]);

  useEffect(() => {
    const controller = new AbortController();
    const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
    fetch(`${base}/api/data/crop-budgets`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Budget data unavailable");
        const data = await response.json() as { budgets: CropBudget[] };
        if (!Array.isArray(data.budgets) || !data.budgets.length) throw new Error("Budget data unavailable");
        setBudgets(data.budgets);
        setBudgetStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setBudgetStatus("unavailable"); });
    return () => controller.abort();
  }, []);

  function familyForCrop(name: string, manualFamily = ""): string | null {
    return inferCropFamily(name) ??
      (manualFamily || cropClassifications[cropNameKey(name)]?.family || null);
  }

  function classificationForCrop(name: string): CropClassification | undefined {
    return cropClassifications[cropNameKey(name)];
  }

  function invalidatePlan() {
    setPlan(null);
    setScenarios([]);
    setSelectedScenario(0);
    setSeasons([]);
    setError(null);
    onPlanCleared();
  }

  function updateDesiredCrop(id: number, patch: DesiredCropPatch) {
    setDesiredCrops((crops) => crops.map((crop) => crop.id === id ? { ...crop, ...patch } : crop));
    invalidatePlan();
  }

  function addDesiredCrop() {
    setDesiredCrops((crops) => [...crops, {
      id: nextCropId,
      name: "",
      family: "",
      waterDemand: "unknown",
      waterDemandManual: false,
      expectedYield: "",
      expectedPrice: "",
      budgetIndex: "",
      customCost: "",
    }]);
    setNextCropId((id) => id + 1);
    invalidatePlan();
  }

  function removeDesiredCrop(id: number) {
    setDesiredCrops((crops) => crops.filter((crop) => crop.id !== id));
    invalidatePlan();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    invalidatePlan();
    setClassifying(true);

    try {
      const cropNames = [...new Set([currentCrop.name, ...desiredCrops.map((crop) => crop.name)]
        .map((name) => name.trim())
        .filter(Boolean))];
      let classifications = cropClassifications;
      try {
        const result = await classifyCrops(cropNames, fieldSoil);
        classifications = {
          ...cropClassifications,
          ...Object.fromEntries(result.classifications.map((item) => [cropNameKey(item.crop_name), item])),
        };
        setCropClassifications(classifications);
      } catch {
        // Local crop-family recognition and manual category selection remain available offline.
      }

      const currentCropWithFamily = {
        ...currentCrop,
        family: inferCropFamily(currentCrop.name) ??
          (currentCrop.family || classifications[cropNameKey(currentCrop.name)]?.family || ""),
      };
      const desiredCropsWithFamilies: CropWithFamily[] = desiredCrops.map((crop) => ({
        ...crop,
        family: inferCropFamily(crop.name) ??
          (crop.family || classifications[cropNameKey(crop.name)]?.family || ""),
        waterDemand: crop.waterDemandManual
          ? crop.waterDemand
          : classifications[cropNameKey(crop.name)]?.water_demand ?? crop.waterDemand,
      }));
      setCurrentCrop(currentCropWithFamily);
      setDesiredCrops((previous) => previous.map((crop, index) => ({
        ...crop,
        family: desiredCropsWithFamilies[index].family,
        waterDemand: desiredCropsWithFamilies[index].waterDemand,
      })));
      if (!currentCropWithFamily.family || desiredCropsWithFamilies.some((crop) => !crop.family)) {
        setError("Choose a family for each custom crop before building the sequence.");
        return;
      }
      const nextPlan = buildCropRotationPlan(
        currentCropWithFamily,
        desiredCropsWithFamilies,
        Number(rotationLength),
      );
      if (!nextPlan) {
        setError("These crops cannot fill that many years without repeating a family in consecutive years. Add another family or shorten the rotation.");
        return;
      }
      setPlan(nextPlan);
      const currentYear = new Date().getFullYear();
      setSeasons(nextPlan.map((crop, index) => ({
        id: index + 1,
        year: currentYear + index,
        cropName: crop.name,
        plantingDate: "",
        harvestDate: "",
      })));
      const grossRevenue = (crop: CropWithFamily): number | null => {
        const yieldValue = Number(crop.expectedYield);
        const priceValue = Number(crop.expectedPrice);
        if (!crop.expectedYield || !crop.expectedPrice || !Number.isFinite(yieldValue) || !Number.isFinite(priceValue) || yieldValue < 0 || priceValue < 0) return null;
        return yieldValue * priceValue;
      };
      const budgetMargin = (crop: CropWithFamily): number | null => {
        const revenue = grossRevenue(crop);
        const budget = crop.budgetIndex === "" || crop.budgetIndex === "custom" ? undefined : budgets[Number(crop.budgetIndex)];
        const cost = crop.budgetIndex === "custom"
          ? crop.customCost.trim() === "" ? null : Number(crop.customCost)
          : budget?.cost_cad_per_hectare ?? null;
        return revenue === null || cost === null || !Number.isFinite(cost) || cost < 0 ? null : revenue - cost;
      };
      const makeScenario = (
        name: string,
        crops: CropWithFamily[],
        summarize: (scenarioPlan: PlannedRotationCrop[]) => string,
      ): RotationScenario => {
        const scenarioPlan = buildCropRotationPlan(currentCropWithFamily, crops, Number(rotationLength));
        const cropFits = scenarioPlan && fieldSoil
          ? scenarioPlan.map((crop) => screenCropFieldFit(crop.name, fieldSoil))
          : [];
        const ratedFits = cropFits.filter((fit) => fit.score !== null);
        const futureCrops = scenarioPlan?.slice(1) ?? [];
        const uniqueFamilies = new Set(futureCrops.map((crop) => crop.family.toLowerCase()));
        const familyConflictCount = futureCrops.slice(1).filter(
          (crop, index) => crop.family.toLowerCase() === futureCrops[index].family.toLowerCase(),
        ).length;
        const waterValues = futureCrops
          .map((crop) => crops.find((candidate) => candidate.name === crop.name)?.waterDemand)
          .filter((demand): demand is Exclude<DesiredCrop["waterDemand"], "unknown"> =>
            Boolean(demand && demand !== "unknown"),
          );
        const waterRanks = { lower: 1, moderate: 2, higher: 3 } as const;
        const averageWaterRank = waterValues.length
          ? waterValues.reduce((sum, demand) => sum + waterRanks[demand], 0) / waterValues.length
          : null;
        const revenues = futureCrops.map((crop) => {
          const entry = crops.find((candidate) => candidate.name === crop.name);
          return entry ? grossRevenue(entry) : null;
        });
        const knownRevenues = revenues.filter((revenue): revenue is number => revenue !== null);
        const margins = futureCrops.map((crop) => {
          const entry = crops.find((candidate) => candidate.name === crop.name);
          return entry ? budgetMargin(entry) : null;
        });
        const knownMargins = margins.filter((margin): margin is number => margin !== null);
        return {
          name,
          plan: scenarioPlan,
          note: scenarioPlan ? summarize(scenarioPlan) : "This crop order cannot fill the selected rotation length while alternating families.",
          fieldFitScore: ratedFits.length
            ? Math.round(ratedFits.reduce((sum, fit) => sum + (fit.score ?? 0), 0) / ratedFits.length)
            : null,
          fieldFitCoveragePct: scenarioPlan?.length
            ? Math.round(ratedFits.length / scenarioPlan.length * 100)
            : 0,
          familyDiversityPct: futureCrops.length
            ? Math.round(uniqueFamilies.size / futureCrops.length * 100)
            : null,
          familyCount: uniqueFamilies.size,
          familyConflictCount,
          relativeWaterDemand: averageWaterRank === null
            ? null
            : averageWaterRank.toFixed(1),
          estimatedGrossRevenuePerHa: knownRevenues.length === futureCrops.length && knownRevenues.length
            ? Math.round(knownRevenues.reduce((sum, value) => sum + value, 0) / knownRevenues.length)
            : null,
          revenueCoveragePct: futureCrops.length
            ? Math.round(knownRevenues.length / futureCrops.length * 100)
            : 0,
          estimatedMarginPerHa: knownMargins.length === futureCrops.length && knownMargins.length
            ? Math.round(knownMargins.reduce((sum, value) => sum + value, 0) / knownMargins.length)
            : null,
        };
      };
      const waterOrder = [...desiredCropsWithFamilies].sort((a, b) => {
        const waterRank = { lower: 0, moderate: 1, higher: 2, unknown: 3 };
        return waterRank[a.waterDemand] - waterRank[b.waterDemand];
      });
      const legumeFirst = [...desiredCropsWithFamilies].sort((a, b) =>
        Number(b.family === "Fabaceae") - Number(a.family === "Fabaceae"),
      );
      const hasAllMargins = desiredCropsWithFamilies.every((crop) => budgetMargin(crop) !== null);
      const profitOrder = hasAllMargins
        ? [...desiredCropsWithFamilies].sort((a, b) => budgetMargin(b)! - budgetMargin(a)!)
        : desiredCropsWithFamilies;
      const waterRank = { lower: 0, moderate: 1, higher: 2, unknown: 3 };
      const waterLabel = { lower: "Lower", moderate: "Moderate", higher: "Higher", unknown: "Not entered" };
      const waterSummary = (scenarioPlan: PlannedRotationCrop[]) => {
        const selectedDemands = desiredCropsWithFamilies.map((crop) => crop.waterDemand);
        if (selectedDemands.every((demand) => demand === "unknown")) {
          return "Choose a relative water demand for at least one candidate crop to prioritize lower-demand options; water use is not estimated.";
        }
        const counts = new Map<DesiredCrop["waterDemand"], number>();
        for (const crop of scenarioPlan.slice(1)) {
          const entry = desiredCropsWithFamilies.find((item) => item.name === crop.name);
          const demand = entry?.waterDemand ?? "unknown";
          counts.set(demand, (counts.get(demand) ?? 0) + 1);
        }
        return [...counts.entries()]
          .sort((a, b) => waterRank[a[0]] - waterRank[b[0]])
          .map(([demand, count]) => `${waterLabel[demand]}: ${count} year${count === 1 ? "" : "s"}`)
          .join(" · ");
      };
      const scenariosWithPlans = [
        makeScenario("Current rotation", desiredCropsWithFamilies, () =>
          "Year 1 is your current crop; future years follow the crop order you entered."),
        makeScenario("Budget margin focused", profitOrder, () => hasAllMargins
          ? "Ordered by expected yield × price minus the selected or entered cost. Ontario samples exclude land rent and other farm-specific costs; user-entered costs depend on what you include."
          : "Enter yield and price, then select a budget or enter a cost for every crop to rank by budget margin. Until all inputs are available, crops remain in the order you entered."),
        makeScenario("Water conservation", waterOrder, (scenarioPlan) =>
          `${waterSummary(scenarioPlan)}. Lower relative-demand crops are scheduled first; this is not an irrigation-volume estimate.`),
        makeScenario("Soil regeneration", legumeFirst, (scenarioPlan) => {
          const futureYears = scenarioPlan.slice(1);
          const legumeYears = futureYears.filter((crop) => crop.family === "Fabaceae").length;
          const crops = futureYears.map((crop) => crop.name).join(" → ");
          return `${legumeYears} of ${futureYears.length} future seasons use legumes. Sequence: ${crops}. This is a family heuristic, not a validated soil-health score.`;
        }),
      ];
      setScenarios(scenariosWithPlans);
      onPlanReady();
    } catch (planningError) {
      setError(planningError instanceof Error ? planningError.message : "Unable to build this crop sequence.");
    } finally {
      setClassifying(false);
    }
  }

  function updateSeason(id: number, patch: Partial<Omit<SeasonRow, "id">>) {
    setSeasons((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addSeason() {
    setSeasons((rows) => {
      const nextId = rows.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1;
      const latestYear = rows.reduce((maximum, row) => Math.max(maximum, row.year), new Date().getFullYear() - 1);
      return [...rows, {
        id: nextId,
        year: latestYear + 1,
        cropName: "",
        plantingDate: "",
        harvestDate: "",
      }];
    });
  }

  function removeSeason(id: number) {
    setSeasons((rows) => rows.filter((row) => row.id !== id));
  }

  const cropOptions = [...new Map(
    [currentCrop, ...desiredCrops].filter((crop) => crop.name.trim()).map((crop) => {
      const family = inferCropFamily(crop.name) ?? crop.family;
      return [crop.name.trim().toLowerCase(), { name: crop.name.trim(), family }];
    }),
  ).values()];

  const resultsBody = plan && (
    <div aria-live="polite" className="crop-plan-result">
      <p className="rotation-provenance">Planning sequences, not performance ratings.</p>
      <div aria-label="Rotation scenario" className="rotation-scenario-picker" role="group">
        {scenarios.map((scenario, index) => (
          <button
            aria-pressed={selectedScenario === index}
            className="rotation-scenario-option"
            key={scenario.name}
            onClick={() => setSelectedScenario(index)}
            type="button"
          >
            {scenario.name}
          </button>
        ))}
      </div>
      <ul className="rotation-scenario-list">
        {scenarios.map((scenario, index) => {
          const matchesBaseline = index > 0 && scenarios[0].plan?.every(
            (crop, cropIndex) => crop.name === scenario.plan?.[cropIndex]?.name,
          );
          return (
          <li hidden={selectedScenario !== index} key={scenario.name}>
            <div className="rotation-scenario-heading">
              <strong>{scenario.name}</strong>
              {matchesBaseline && <span>Same order as the current rotation</span>}
            </div>
            {scenario.plan ? (
              <>
                <ol className="crop-plan-timeline" aria-label={`${scenario.name} crop sequence`}>
                  {scenario.plan.map((crop) => (
                    <li key={crop.year}>
                      <span>Year {crop.year}{crop.isCurrent ? " · Current" : ""}</span>
                      <strong>{crop.name}</strong>
                      <small>{familyLabel(crop.family)}</small>
                    </li>
                  ))}
                </ol>
                <dl className="rotation-score-grid">
                  <div>
                    <dt>Average field soil fit</dt>
                    <dd className={scenario.fieldFitScore == null ? "rotation-metric-pending" : undefined}>{scenario.fieldFitScore == null
                      ? fieldSoil ? "Not rated" : "Needs field soil data"
                      : `${scenario.fieldFitScore}/100`}</dd>
                    {scenario.fieldFitScore != null && <small>{scenario.fieldFitCoveragePct}% of planned crops rated</small>}
                  </div>
                  <div>
                    <dt>Family diversity</dt>
                    <dd>{scenario.familyCount} distinct {scenario.familyCount === 1 ? "family" : "families"}</dd>
                    <small>{scenario.plan.length - 1} future seasons · {scenario.familyConflictCount === 0 ? "No consecutive repeats" : `${scenario.familyConflictCount} consecutive repeats`}</small>
                  </div>
                  <div>
                    <dt>Relative water demand</dt>
                    <dd className={scenario.relativeWaterDemand == null ? "rotation-metric-pending" : undefined}>{scenario.relativeWaterDemand == null
                      ? "Enter crop demand"
                      : `${scenario.relativeWaterDemand}/3`}</dd>
                    {scenario.relativeWaterDemand != null && <small>1 = lower · 3 = higher</small>}
                  </div>
                  <div>
                    <dt>Gross revenue estimate</dt>
                    <dd className={scenario.estimatedGrossRevenuePerHa == null ? "rotation-metric-pending" : undefined}>{scenario.estimatedGrossRevenuePerHa == null
                      ? "Yield and price needed"
                      : `$${scenario.estimatedGrossRevenuePerHa.toLocaleString()}/ha`}</dd>
                    {scenario.estimatedGrossRevenuePerHa != null && <small>{scenario.revenueCoveragePct}% of future seasons priced · before costs</small>}
                  </div>
                  <div>
                    <dt>Budget margin estimate</dt>
                    <dd className={scenario.estimatedMarginPerHa == null ? "rotation-metric-pending" : undefined}>{scenario.estimatedMarginPerHa == null
                      ? "Yield, price, and budget needed"
                      : `$${scenario.estimatedMarginPerHa.toLocaleString()}/ha`}</dd>
                    <small>Average per future season · depends on costs included</small>
                  </div>
                </dl>
                <details className="rotation-scenario-details">
                  <summary>How This Scenario Works</summary>
                  <p className="rotation-scenario-note">{scenario.note}</p>
                </details>
              </>
            ) : (
              <p className="rotation-error">Add crops from more families or shorten the rotation.</p>
            )}
          </li>
          );
        })}
      </ul>

      <section aria-labelledby="season-schedule-title" className="season-editor">
        <div className="rotation-section-heading">
          <div>
            <p className="eyebrow">Year-by-year plan</p>
            <h3 id="season-schedule-title">Crop Rotation Schedule</h3>
          </div>
          <button className="crop-add-button season-add-button" onClick={addSeason} type="button">
            <Plus aria-hidden="true" size={16} />
            Add season
          </button>
        </div>
        <div aria-hidden="true" className="season-table-header">
          <span>Season</span>
          <span>Crop</span>
          <span>Planting date</span>
          <span>Harvest date</span>
          <span />
        </div>
        <div className="season-row-list">
          {seasons.map((season) => (
            <div className="season-row" key={season.id}>
              <div className="season-year">
                <strong>Season {season.year}</strong>
                <small>
                  {season.plantingDate || season.harvestDate
                    ? `${season.plantingDate || "Date TBD"} – ${season.harvestDate || "Date TBD"}`
                    : "Dates not set"}
                </small>
              </div>
              <label>
                <span className="season-mobile-label">Crop</span>
                <select
                  onChange={(event) => updateSeason(season.id, { cropName: event.target.value })}
                  value={season.cropName}
                >
                  <option value="">Choose crop</option>
                  {cropOptions.map((crop) => (
                    <option key={crop.name} value={crop.name}>{crop.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="season-mobile-label">Planting date</span>
                <input
                  aria-label={`Season ${season.year} planting date`}
                  onChange={(event) => updateSeason(season.id, { plantingDate: event.target.value })}
                  type="date"
                  value={season.plantingDate}
                />
              </label>
              <label>
                <span className="season-mobile-label">Harvest date</span>
                <input
                  aria-label={`Season ${season.year} harvest date`}
                  onChange={(event) => updateSeason(season.id, { harvestDate: event.target.value })}
                  type="date"
                  value={season.harvestDate}
                />
              </label>
              <button
                aria-label={`Remove season ${season.year}`}
                className="crop-remove-button season-remove-button"
                onClick={() => removeSeason(season.id)}
                title="Remove season"
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  if (stage === "hidden") {
    return null;
  }

  if (stage === "results") {
    return (
      <section aria-labelledby="crop-results-title" className="rotation-section">
        <div className="rotation-section-heading">
          <div>
            <p className="eyebrow">Results</p>
            <h2 id="crop-results-title">Rotation Scenarios for {fieldName}</h2>
          </div>
          <button className="wizard-back" onClick={onEditCrops} type="button">
            ← Edit crops
          </button>
        </div>
        {plan ? (
          resultsBody
        ) : (
          <p className="rotation-provenance">
            Build a sequence in the Crops step to see rotation scenarios.
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="crop-plan-title" className="rotation-section">
      <p className="eyebrow">Your crop choices</p>
      <h2 id="crop-plan-title">Plan a Crop Rotation</h2>
      <details className="crop-budget-source">
        <summary>About Ontario Budget Estimates</summary>
        <p className="rotation-provenance">
          <a href="https://www.ontario.ca/page/publication-60-field-crop-budgets" target="_blank" rel="noreferrer">Ontario Publication 60, 2026</a>: sample costs based on assumed practices and yields; input prices projected in November 2025. Actual field costs can differ. Margin estimates exclude land rent and other farm-specific costs.
        </p>
      </details>

      <form className="crop-rotation-form" onSubmit={handleSubmit}>
        <div className="crop-entry-grid">
          <label>
            Current crop
            <input
              onChange={(event) => {
                setCurrentCrop((crop) => ({ ...crop, name: event.target.value }));
                invalidatePlan();
              }}
              placeholder="e.g., corn"
              required
              value={currentCrop.name}
            />
          </label>
          {familyForCrop(currentCrop.name, currentCrop.family) ? (
            <div className="crop-family-inferred">
              <span>Crop family</span>
              <strong>{familyLabel(familyForCrop(currentCrop.name, currentCrop.family) ?? "")}</strong>
              <small>{familySuggestionLabel(
                currentCrop.name,
                currentCrop.family,
                classificationForCrop(currentCrop.name),
              )}</small>
            </div>
          ) : currentCrop.name.trim() ? (
            <label>
              Crop family for this crop
              <select
                onChange={(event) => {
                  setCurrentCrop((crop) => ({ ...crop, family: event.target.value }));
                  invalidatePlan();
                }}
                value={currentCrop.family}
              >
                <option value="">Choose family</option>
                {cropFamilyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : (
            <p className="crop-family-prompt">We&apos;ll infer the crop family from a recognized crop name.</p>
          )}
        </div>
        {fieldSoil && currentCrop.name.trim() && (() => {
          const fit = screenCropFieldFit(currentCrop.name, fieldSoil);
          return (
            <p className="crop-fit-inline">
              Current crop soil screen: {fit.score === null ? fit.verdict : `${fit.verdict} · ${fit.score}/100`}
            </p>
          );
        })()}

        <fieldset className="crop-choice-fieldset">
          <legend>Crops You Want to Plant</legend>
          {desiredCrops.length === 0 && (
            <p className="rotation-provenance">Add crops you want to consider and their relative water demand.</p>
          )}
          <div className="desired-crop-list">
            {desiredCrops.map((crop, index) => (
              <div className="desired-crop-row" key={crop.id}>
                <label>
                  Crop {index + 1}
                  <input
                    onChange={(event) => updateDesiredCrop(crop.id, { name: event.target.value, budgetIndex: "", customCost: "", waterDemand: "unknown", waterDemandManual: false })}
                    placeholder="e.g., soybean"
                    required
                    value={crop.name}
                  />
                </label>
                {familyForCrop(crop.name, crop.family) ? (
                  <div className="crop-family-inferred">
                    <span>Family</span>
                    <strong>{familyLabel(familyForCrop(crop.name, crop.family) ?? "")}</strong>
                    <small>{familySuggestionLabel(
                      crop.name,
                      crop.family,
                      classificationForCrop(crop.name),
                    )}</small>
                  </div>
                ) : crop.name.trim() ? (
                  <label>
                    Crop family
                    <select
                      onChange={(event) => updateDesiredCrop(crop.id, { family: event.target.value })}
                      value={crop.family}
                    >
                      <option value="">Choose family</option>
                      {cropFamilyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <p className="crop-family-prompt">We infer the family from the crop name.</p>
                )}
                <label className="crop-water-demand">
                  Relative water demand
                  <select
                    onChange={(event) => updateDesiredCrop(crop.id, {
                      waterDemand: event.target.value as DesiredCrop["waterDemand"],
                      waterDemandManual: true,
                    })}
                    value={crop.waterDemandManual ? crop.waterDemand : classificationForCrop(crop.name)?.water_demand ?? "unknown"}
                  >
                    <option value="unknown">Not sure</option>
                    <option value="lower">Lower</option>
                    <option value="moderate">Moderate</option>
                    <option value="higher">Higher</option>
                  </select>
                  {classificationForCrop(crop.name)?.water_demand !== undefined &&
                    classificationForCrop(crop.name)?.water_demand !== "unknown" && !crop.waterDemandManual && (
                      <small className="crop-classification-note">
                        {classificationForCrop(crop.name)?.water_method === "gemini" ? "Gemini estimate · confirm for your field" : "Crop reference estimate · confirm for your field"}
                      </small>
                    )}
                  {classificationForCrop(crop.name)?.water_demand === "unknown" && !crop.waterDemandManual && (
                    <small className="crop-classification-note">No water demand estimate available for this crop.</small>
                  )}
                </label>
                <label className="crop-estimate-input">
                  Expected yield (t/ha)
                  <input
                    min="0"
                    onChange={(event) => updateDesiredCrop(crop.id, { expectedYield: event.target.value })}
                    placeholder="Optional"
                    step="any"
                    type="number"
                    value={crop.expectedYield}
                  />
                </label>
                <label className="crop-estimate-input">
                  Local price ($/t)
                  <input
                    min="0"
                    onChange={(event) => updateDesiredCrop(crop.id, { expectedPrice: event.target.value })}
                    placeholder="Optional"
                    step="any"
                    type="number"
                    value={crop.expectedPrice}
                  />
                </label>
                <label className="crop-estimate-input crop-budget-input">
                  Cost source
                  <select
                    onChange={(event) => updateDesiredCrop(crop.id, { budgetIndex: event.target.value })}
                    value={crop.budgetIndex}
                  >
                    <option value="">{budgetStatus === "loading" ? "Loading Ontario budgets…" : budgetStatus === "unavailable" ? "Ontario budgets unavailable" : !crop.name.trim() ? "Enter a crop first" : !budgets.some((budget) => matchingBudgetCrops(crop.name).includes(cropNameKey(budget.crop))) ? "No Ontario budget matches this crop" : "Select a cost source"}</option>
                    <option value="custom">Enter my own cost</option>
                    {budgets.map((budget, budgetIndex) => matchingBudgetCrops(crop.name).includes(cropNameKey(budget.crop)) && (
                      <option key={`${budget.crop}-${budget.practice}`} value={budgetIndex}>
                        {budget.crop}{budget.practice ? ` · ${budget.practice}` : ""} · ${budget.cost_cad_per_hectare}/ha
                      </option>
                    ))}
                  </select>
                  {crop.budgetIndex !== "" && crop.budgetIndex !== "custom" && <small>Ontario 2026 sample · excludes land rent and other farm-specific costs</small>}
                </label>
                {crop.budgetIndex === "custom" && (
                  <label className="crop-estimate-input crop-budget-input">
                    Your growing cost ($/ha)
                    <input
                      min="0"
                      onChange={(event) => updateDesiredCrop(crop.id, { customCost: event.target.value })}
                      placeholder="Enter cost per hectare"
                      step="any"
                      type="number"
                      value={crop.customCost}
                    />
                    <small>Include the costs you want reflected in your estimate.</small>
                  </label>
                )}
                {fieldSoil && (
                  <p className="crop-fit-inline">
                    Soil screen: {(() => {
                      const fit = screenCropFieldFit(crop.name, fieldSoil);
                      return fit.score === null ? fit.verdict : `${fit.verdict} · ${fit.score}/100`;
                    })()}
                  </p>
                )}
                <button
                  aria-label={`Remove desired crop ${crop.name || index + 1}`}
                  className="crop-remove-button"
                  onClick={() => removeDesiredCrop(crop.id)}
                  title="Remove crop"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
            ))}
          </div>
          <button className="crop-add-button" onClick={addDesiredCrop} type="button">
            <Plus aria-hidden="true" size={16} />
            Add a crop
          </button>
        </fieldset>

        <div className="crop-plan-actions">
          <label>
            Rotation length, including current year
            <input
              max="12"
              min="2"
              onChange={(event) => {
                setRotationLength(event.target.value);
                invalidatePlan();
              }}
              required
              type="number"
              value={rotationLength}
            />
          </label>
          <div className="wizard-nav">
            <button className="wizard-back" onClick={onBackToField} type="button">
              ← Field
            </button>
            <button className="crop-plan-submit" disabled={classifying} type="submit">
              {classifying ? "Checking crops…" : "Build sequence →"}
            </button>
          </div>
        </div>
      </form>

      {error && <p aria-live="polite" className="rotation-error" role="alert">{error}</p>}
    </section>
  );
}
