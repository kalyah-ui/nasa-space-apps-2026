"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { getTerrainSample, type TerrainSample } from "@/lib/datasets/terrain-client";
import {
  loadFieldCatalog,
  SELECTED_FIELD_STORAGE_KEY,
  type FieldOption,
} from "@/lib/fields/field-catalog";
import { CropRotationBuilder } from "./crop-rotation-builder";
import { FieldInsights } from "./field-insights";
import { summarizeFieldSoil } from "@/lib/recommendations/field-fit";

type WizardStep = 1 | 2 | 3;

const wizardSteps: { number: WizardStep; label: string }[] = [
  { number: 1, label: "Field" },
  { number: 2, label: "Crops" },
  { number: 3, label: "Results" },
];

export function RotationPlanner() {
  const [fields, setFields] = useState<FieldOption[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>(1);
  const [resultsReady, setResultsReady] = useState(false);
  const [sample, setSample] = useState<TerrainSample | null>(null);
  const [sampleStatus, setSampleStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sampleError, setSampleError] = useState<string | null>(null);
  // Guards against a stale terrain response landing after the field changed.
  const sampleFieldRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadFields() {
      try {
        const loadedFields = await loadFieldCatalog(controller.signal);
        if (!active) return;
        setFields(loadedFields);
        const savedFieldId = window.localStorage.getItem(SELECTED_FIELD_STORAGE_KEY);
        const initialField = loadedFields.find((field) => field.id === savedFieldId) ?? loadedFields[0];
        setSelectedFieldId(initialField.id);
      } catch (loadError) {
        if (active && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setFieldsError(loadError instanceof Error ? loadError.message : "Unable to load fields.");
        }
      } finally {
        if (active) setFieldsLoading(false);
      }
    }

    void loadFields();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? null;
  const fieldSoil = sample ? summarizeFieldSoil(sample.soil_landscapes) : null;

  function handleFieldChange(fieldId: string) {
    setSelectedFieldId(fieldId);
    setSample(null);
    setSampleStatus("idle");
    setSampleError(null);
    setResultsReady(false);
    sampleFieldRef.current = null;
    window.localStorage.setItem(SELECTED_FIELD_STORAGE_KEY, fieldId);
  }

  function loadSample(field: FieldOption) {
    sampleFieldRef.current = field.id;
    setSampleStatus("loading");
    setSampleError(null);
    getTerrainSample(field)
      .then((loadedSample) => {
        if (sampleFieldRef.current !== field.id) return;
        setSample(loadedSample);
        setSampleStatus("ready");
      })
      .catch((requestError: unknown) => {
        if (sampleFieldRef.current !== field.id) return;
        setSampleStatus("error");
        setSampleError(
          requestError instanceof Error ? requestError.message : "Unable to extract field data.",
        );
      });
  }

  function handleFieldSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Terrain context loads in the background; the crops step never waits on it.
    if (selectedField && sampleStatus === "idle") loadSample(selectedField);
    setStep(2);
  }

  const maxStep: WizardStep = resultsReady ? 3 : 2;

  return (
    <div className="rotation-planner">
      <ol aria-label="Rotation planner steps" className="wizard-steps">
        {wizardSteps.map((wizardStep) => (
          <li key={wizardStep.number}>
            <button
              aria-current={step === wizardStep.number ? "step" : undefined}
              className={`wizard-step${step === wizardStep.number ? " is-active" : ""}${
                wizardStep.number < step ? " is-done" : ""
              }`}
              disabled={wizardStep.number > maxStep}
              onClick={() => setStep(wizardStep.number)}
              type="button"
            >
              <span aria-hidden="true" className="wizard-step-number">
                {wizardStep.number}
              </span>
              {wizardStep.label}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section aria-labelledby="wizard-field-title" className="rotation-section">
          <h2 id="wizard-field-title">Choose a field</h2>
          <p className="rotation-provenance">
            Soil and terrain context for this field loads in the background and appears with your
            results.
          </p>

          <form className="rotation-location-form" onSubmit={handleFieldSubmit}>
            <label className="rotation-field-select">
              Your field
              <select
                disabled={fieldsLoading || fields.length === 0}
                onChange={(event) => handleFieldChange(event.target.value)}
                value={selectedFieldId}
              >
                {fieldsLoading && <option value="">Loading fields…</option>}
                {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
              </select>
            </label>
            <button disabled={fieldsLoading} type="submit">
              Next: Choose crops →
            </button>
          </form>

          {fieldsError && <p className="rotation-error" role="alert">{fieldsError}</p>}
        </section>
      )}

      <CropRotationBuilder
        fieldName={selectedField?.name ?? "your field"}
        fieldSoil={fieldSoil}
        key={selectedFieldId}
        onBackToField={() => setStep(1)}
        onEditCrops={() => setStep(2)}
        onPlanCleared={() => setResultsReady(false)}
        onPlanReady={() => {
          setResultsReady(true);
          setStep(3);
        }}
        stage={step === 2 ? "crops" : step === 3 ? "results" : "hidden"}
      />

      {step === 3 &&
        (sampleStatus === "ready" && sample && fieldSoil ? (
          <FieldInsights fieldSoil={fieldSoil} sample={sample} />
        ) : sampleStatus === "loading" ? (
          <p className="rotation-provenance" role="status">
            Loading soil and terrain insights for {selectedField?.name ?? "this field"}…
          </p>
        ) : sampleStatus === "error" ? (
          <p className="source-muted" role="status">
            <span>Field soil and terrain insights are unavailable: {sampleError}</span>
            <button
              className="source-error-retry"
              onClick={() => selectedField && loadSample(selectedField)}
              type="button"
            >
              Retry
            </button>
          </p>
        ) : null)}
    </div>
  );
}
