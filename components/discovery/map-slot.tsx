"use client";

import type { DiscoveryMapProps } from "./map-contract";

/**
 * Placeholder for the real map component. Implements the DiscoveryMapProps
 * contract with schematic marker placement: lat/lon are projected linearly
 * into the box, so relative positions are accurate, but it is not a real map.
 */
export function MapSlot({
  markers,
  selectedMarkerId,
  highlightedMarkerId,
  onSelectMarker,
  onHoverMarker,
}: DiscoveryMapProps) {
  const latitudes = markers.map((marker) => marker.latitude);
  const longitudes = markers.map((marker) => marker.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const latSpan = maxLat - minLat || 1;
  const lonSpan = maxLon - minLon || 1;

  // 8% padding on every side so edge markers stay fully visible.
  const positionStyle = (latitude: number, longitude: number) => ({
    left: `${((longitude - minLon) / lonSpan) * 84 + 8}%`,
    top: `${((maxLat - latitude) / latSpan) * 84 + 8}%`,
  });

  return (
    <div aria-label="Schematic map of demo parcels" className="discovery-map" role="group">
      {markers.map((marker) => {
        const isSelected = marker.id === selectedMarkerId;
        const isHighlighted = marker.id === highlightedMarkerId;
        return (
          <button
            aria-pressed={isSelected}
            className={`discovery-map-pill${isSelected ? " is-selected" : ""}${
              isHighlighted ? " is-highlighted" : ""
            }`}
            key={marker.id}
            onBlur={() => onHoverMarker(null)}
            onClick={() => onSelectMarker(marker.id)}
            onFocus={() => onHoverMarker(marker.id)}
            onMouseEnter={() => onHoverMarker(marker.id)}
            onMouseLeave={() => onHoverMarker(null)}
            style={positionStyle(marker.latitude, marker.longitude)}
            type="button"
          >
            {marker.label}
          </button>
        );
      })}
      <p className="discovery-map-note">
        A schematic map is shown. Configure Mapbox to enable the interactive map.
      </p>
    </div>
  );
}
