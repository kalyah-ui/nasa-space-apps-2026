"use client";

import mapboxgl, { type MapboxErrorEvent } from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import type { DiscoveryMapProps } from "./map-contract";
import { MapSlot } from "./map-slot";

/**
 * Real Mapbox implementation of the Discovery map contract. Markers are the
 * same glass pills as the schematic map, placed at true coordinates.
 * Without NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN it falls back to the schematic
 * MapSlot so the page keeps working.
 */
export function DiscoveryMap(props: DiscoveryMapProps) {
  if (!process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) {
    return <MapSlot {...props} />;
  }

  return <LiveDiscoveryMap {...props} />;
}

type MarkerEntry = {
  marker: mapboxgl.Marker;
  button: HTMLButtonElement;
};

function LiveDiscoveryMap({
  markers,
  selectedMarkerId,
  highlightedMarkerId,
  onSelectMarker,
  onHoverMarker,
}: DiscoveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerEntriesRef = useRef(new Map<string, MarkerEntry>());
  const hasFitBoundsRef = useRef(false);
  // Marker DOM nodes outlive any single render, so they read the latest
  // callbacks through this ref instead of capturing stale ones.
  const callbacksRef = useRef({ onHoverMarker, onSelectMarker });
  const [mapError, setMapError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onHoverMarker, onSelectMarker };
  }, [onHoverMarker, onSelectMarker]);

  useEffect(() => {
    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!accessToken || !containerRef.current) {
      return;
    }

    let active = true;

    const map = new mapboxgl.Map({
      accessToken,
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-95.5, 40.5],
      zoom: 3,
      attributionControl: true,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("error", (event: MapboxErrorEvent) => {
      if (!active) {
        return;
      }

      const errorMessage = event.error?.message?.trim();
      setMapError(
        errorMessage
          ? `The map could not be loaded: ${errorMessage}`
          : "A Mapbox resource could not be loaded. Check the public token permissions and network connection.",
      );
      setIsLoading(false);
    });

    map.on("load", () => {
      if (!active) {
        return;
      }
      setMapError(null);
      setIsLoading(false);
      setIsMapReady(true);
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    const markerEntries = markerEntriesRef.current;
    return () => {
      active = false;
      resizeObserver.disconnect();
      markerEntries.clear();
      hasFitBoundsRef.current = false;
      if (mapRef.current === map) {
        mapRef.current = null;
      }
      map.remove();
    };
  }, []);

  // Create, update, and remove markers to match the `markers` prop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) {
      return;
    }

    const entries = markerEntriesRef.current;
    const markerIds = new Set(markers.map((marker) => marker.id));

    for (const [id, entry] of entries) {
      if (!markerIds.has(id)) {
        entry.marker.remove();
        entries.delete(id);
      }
    }

    for (const markerSpec of markers) {
      const existing = entries.get(markerSpec.id);
      if (existing) {
        existing.button.textContent = markerSpec.label;
        existing.marker.setLngLat([markerSpec.longitude, markerSpec.latitude]);
        continue;
      }

      const element = document.createElement("div");
      element.className = "discovery-map-marker";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "discovery-map-pill";
      button.textContent = markerSpec.label;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacksRef.current.onSelectMarker(markerSpec.id);
      });
      button.addEventListener("mouseenter", () =>
        callbacksRef.current.onHoverMarker(markerSpec.id),
      );
      button.addEventListener("mouseleave", () =>
        callbacksRef.current.onHoverMarker(null),
      );
      button.addEventListener("focus", () =>
        callbacksRef.current.onHoverMarker(markerSpec.id),
      );
      button.addEventListener("blur", () =>
        callbacksRef.current.onHoverMarker(null),
      );
      element.appendChild(button);

      const marker = new mapboxgl.Marker({ element })
        .setLngLat([markerSpec.longitude, markerSpec.latitude])
        .addTo(map);
      // Mapbox labels the wrapper role="img", which hides the button from
      // assistive tech; the pill button itself is the accessible control.
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
      entries.set(markerSpec.id, { marker, button });
    }

    if (!hasFitBoundsRef.current && markers.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      markers.forEach((marker) => bounds.extend([marker.longitude, marker.latitude]));
      map.fitBounds(bounds, { duration: 0, maxZoom: 10, padding: 56 });
      hasFitBoundsRef.current = true;
    }
  }, [markers, isMapReady]);

  // Reflect selection and hover state onto the marker pills.
  useEffect(() => {
    for (const [id, entry] of markerEntriesRef.current) {
      const isSelected = id === selectedMarkerId;
      const isHighlighted = id === highlightedMarkerId;
      entry.button.classList.toggle("is-selected", isSelected);
      entry.button.classList.toggle("is-highlighted", isHighlighted);
      entry.button.setAttribute("aria-pressed", String(isSelected));
      // Each Mapbox marker is its own stacking context, so the active pill is
      // lifted at the marker element, not the button.
      entry.marker.getElement().style.zIndex = isSelected || isHighlighted ? "2" : "";
    }
  }, [markers, selectedMarkerId, highlightedMarkerId, isMapReady]);

  return (
    <div
      aria-label="Map of demo parcels"
      className="discovery-map is-live"
      role="group"
    >
      <div aria-hidden={isLoading || undefined} className="discovery-map-canvas" ref={containerRef} />
      {isLoading && !mapError ? (
        <p className="discovery-map-note" role="status">
          Loading map…
        </p>
      ) : null}
      {mapError ? (
        <p className="discovery-map-note is-error" role="alert">
          {mapError}
        </p>
      ) : null}
    </div>
  );
}
