"use client";

import { useEffect, useState } from "react";
import { fieldDataProvider } from "./data/provider-config";
import type { FieldSpec, LayerId, LayerSpec } from "./data/types";
import { FieldMap } from "./field-map";
import { LayerSidebar } from "./layer-sidebar";
import { WorkspaceHeader } from "./workspace-header";

export function FieldWorkspace() {
  const [field, setField] = useState<FieldSpec | null>(null);
  const [layers, setLayers] = useState<LayerSpec[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<LayerId>("satellite");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadWorkspaceData() {
      try {
        const loadedLayers = await fieldDataProvider.listLayers();
        if (active) {
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

        <FieldMap onSelectField={setField} selectedLayerId={selectedLayerId} />
      </div>
    </main>
  );
}
