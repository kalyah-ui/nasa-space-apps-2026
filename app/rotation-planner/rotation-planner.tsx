"use client";

import { type FormEvent, useEffect, useState } from "react";
import { getTerrainSample, type TerrainSample } from "@/lib/datasets/terrain-client";
import {
  loadFieldCatalog,
  SELECTED_FIELD_STORAGE_KEY,
  type FieldOption,
} from "@/lib/fields/field-catalog";
import { CropRotationBuilder } from "./crop-rotation-builder";
import { FieldInsights } from "./field-insights";
import { summarizeFieldSoil } from "@/lib/recommendations/field-fit";

export function RotationPlanner() {
  const [fields, setFields] = useState<FieldOption[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [sample, setSample] = useState<TerrainSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    window.localStorage.setItem(SELECTED_FIELD_STORAGE_KEY, fieldId);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedField) return;
    setError(null);
    setSample(null);
    setLoading(true);

    try {
      setSample(await getTerrainSample(selectedField));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to extract field data.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rotation-planner">
      <section aria-labelledby="terrain-title" className="rotation-section">
        <div className="rotation-section-heading">
          <div>
            <p className="eyebrow">Rotation planner</p>
            <h2 id="terrain-title">Choose a field</h2>
          </div>
        </div>

        <form className="rotation-location-form" onSubmit={handleSubmit}>
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
          <button disabled={loading || fieldsLoading || !selectedField} type="submit">
            {loading ? "Updating field insights…" : "Update field insights"}
          </button>
        </form>

        {fieldsError && <p className="rotation-error" role="alert">{fieldsError}</p>}
        {error && <p aria-live="polite" className="rotation-error" role="alert">{error}</p>}
      </section>

      <CropRotationBuilder
        fieldName={selectedField?.name ?? "your field"}
        fieldSoil={fieldSoil}
        key={selectedFieldId}
      />
      {sample && fieldSoil ? (
        <FieldInsights fieldSoil={fieldSoil} sample={sample} />
      ) : (
        <p className="rotation-provenance">Update field insights to review soil and terrain context for this field.</p>
      )}
    </div>
  );
}
