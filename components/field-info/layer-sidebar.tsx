"use client";

import { useMemo, useState } from "react";
import type { LayerCategory, LayerId, LayerSpec } from "./data/types";

type LayerSidebarProps = {
  layers: LayerSpec[];
  selectedLayerId: LayerId;
  error: string | null;
  onSelectLayer: (layerId: LayerId) => void;
};

const groups: Array<{ id: string; title: string; categories: LayerCategory[] }> = [
  { id: "thematic", title: "Layers", categories: ["thematic"] },
  { id: "vegetation", title: "Vegetation", categories: ["vegetation"] },
  { id: "moisture", title: "Moisture", categories: ["moisture"] },
];

const standardLayerIds: LayerId[] = [
  "productivity",
  "soil-brightness",
  "elevation",
  "satellite",
];

export function LayerSidebar({
  layers,
  selectedLayerId,
  error,
  onSelectLayer,
}: LayerSidebarProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const layerById = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer])),
    [layers],
  );

  const matches = (layer: LayerSpec) =>
    !normalizedQuery || layer.label.toLocaleLowerCase().includes(normalizedQuery);

  const renderLayer = (layer: LayerSpec) => (
    <button
      aria-pressed={layer.available ? selectedLayerId === layer.id : undefined}
      className={`field-layer-row${selectedLayerId === layer.id ? " is-selected" : ""}`}
      disabled={!layer.available}
      key={layer.id}
      onClick={() => onSelectLayer(layer.id)}
      title={layer.unavailableReason}
      type="button"
    >
      <span aria-hidden="true" className="field-layer-indicator" />
      <span className="field-layer-name">{layer.label}</span>
      {!layer.available ? (
        <span className="field-layer-unavailable">Not available</span>
      ) : null}
    </button>
  );

  const standardLayers = standardLayerIds
    .map((id) => layerById.get(id))
    .filter((layer): layer is LayerSpec => Boolean(layer))
    .filter(matches);

  return (
    <aside aria-label="Field workspace layers" className="field-workspace-sidebar">
      <label className="field-workspace-search">
        <span aria-hidden="true" className="field-workspace-search-icon" />
        <span className="field-workspace-visually-hidden">Search layers</span>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search..."
          type="search"
          value={query}
        />
      </label>

      <section aria-label="Map modes" className="field-workspace-section">
        <div className="field-workspace-mode-row">
          <span aria-hidden="true" className="field-workspace-mode-icon">◐</span>
          <span>Coloring</span>
          <span className="field-workspace-mode-current">Current</span>
        </div>
        <div
          aria-disabled="true"
          className="field-workspace-mode-row is-disabled"
          title="Side-by-side comparison is planned for a later phase."
        >
          <span aria-hidden="true" className="field-workspace-mode-icon">⇆</span>
          <span>Compare</span>
          <span className="field-workspace-mode-unavailable">Not available</span>
        </div>
      </section>

      {error ? (
        <p className="field-workspace-data-error" role="alert">
          Could not load field layers: {error}
        </p>
      ) : null}

      <section aria-label="Field data layers" className="field-workspace-section">
        <h2 className="field-workspace-section-title">Layers</h2>
        <div className="field-workspace-layer-list">
          {standardLayers.map(renderLayer)}
        </div>
      </section>

      {groups.slice(1).map((group) => {
        const groupLayers = layers
          .filter((layer) => group.categories.includes(layer.category))
          .filter(matches);

        if (groupLayers.length === 0) {
          return null;
        }

        return (
          <section
            aria-label={`${group.title} indices`}
            className="field-workspace-section field-workspace-index-group"
            key={group.id}
          >
            <h2 className="field-workspace-section-title">{group.title}</h2>
            <div className="field-workspace-layer-list">
              {groupLayers.map(renderLayer)}
            </div>
          </section>
        );
      })}

      {normalizedQuery &&
      standardLayers.length === 0 &&
      groups.slice(1).every(
        (group) =>
          !layers.some(
            (layer) =>
              group.categories.includes(layer.category) && matches(layer),
          ),
      ) ? (
        <p className="field-workspace-no-results">No matching layers.</p>
      ) : null}
    </aside>
  );
}
