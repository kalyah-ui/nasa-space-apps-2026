/**
 * Contract between the Discovery browser and the map component.
 *
 * The real map (teammate-owned, components/map) should accept exactly these
 * props; until it lands, `map-slot.tsx` implements the same interface with
 * schematic marker placement. Swapping in the real map is a one-import change
 * in discovery-browser.tsx.
 */

export type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  /** Short text shown in the pill, e.g. "$740k" or a land score like "72". */
  label: string;
};

export type DiscoveryMapProps = {
  markers: MapMarker[];
  /** Marker to render in the selected (accent-filled) state, or null. */
  selectedMarkerId: string | null;
  /** Marker to render highlighted (e.g. its card is hovered), or null. */
  highlightedMarkerId: string | null;
  onSelectMarker: (markerId: string) => void;
  /** null when the pointer leaves a marker. */
  onHoverMarker: (markerId: string | null) => void;
};
