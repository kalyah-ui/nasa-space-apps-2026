"use client";

import { useEffect, useState } from "react";
import { fieldDataProvider } from "./data/provider-config";
import type { FieldSpec, LayerId, LayerSpec } from "./data/types";
import { LayerSidebar } from "./layer-sidebar";
import { WorkspaceHeader } from "./workspace-header";

const fieldId = "demo-field-01";

export function FieldWorkspace() {
  const [field, setField] = useState<FieldSpec | null>(null);
  const [layers, setLayers] = useState<LayerSpec[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<LayerId>("productivity");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadWorkspaceData() {
      try {
        const [loadedField, loadedLayers] = await Promise.all([
          fieldDataProvider.getField(fieldId),
          fieldDataProvider.listLayers(fieldId),
        ]);
        if (!loadedField) {
          throw new Error(`Field "${fieldId}" was not found.`);
        }
        if (active) {
          setField(loadedField);
          setLayers(loadedLayers);
        }
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Unexpected data-provider error.");
        }
      }
    }

    void loadWorkspaceData();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="field-workspace">
      <WorkspaceHeader field={field} />

      <div className="field-workspace-body">
        <LayerSidebar
          error={loadError}
          layers={layers}
          onSelectLayer={setSelectedLayerId}
          selectedLayerId={selectedLayerId}
        />

        <section aria-label="Field map" className="field-workspace-map">
          <div className="field-workspace-map-placeholder">
            <span aria-hidden="true" className="field-workspace-map-mark">F</span>
            <p className="field-workspace-overline">Map workspace</p>
            <h2>Field map coming next</h2>
            <p>
              {layers.find((layer) => layer.id === selectedLayerId)?.label ?? "Productivity map"} selected.
              Map rendering is part of the GIS integration step.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
