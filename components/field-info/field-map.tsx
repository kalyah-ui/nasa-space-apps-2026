"use client";

import mapboxgl, {
  type GeoJSONSourceSpecification,
  type MapboxErrorEvent,
} from "mapbox-gl";
import { type FormEvent, useEffect, useRef, useState } from "react";

const plotGeoJsonUrls = ["/data/PlotA.geojson", "/data/PlotB.geojson"];
const plotSourceId = "farm-plots";
const plotFillLayerId = "farm-plots-fill";
const plotOutlineLayerId = "farm-plots-outline";

type Position = [longitude: number, latitude: number, ...extra: number[]];

type PlotGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

type PlotFeature = {
  type: "Feature";
  id: string;
  properties: { name: string };
  geometry: PlotGeometry;
};

type PlotFeatureCollection = {
  type: "FeatureCollection";
  features: PlotFeature[];
};

type RawFeature = {
  type?: unknown;
  properties?: { name?: unknown } | null;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
};

type RawFeatureCollection = {
  type?: unknown;
  features?: unknown;
};

type GeocodingFeature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    full_address?: unknown;
    name?: unknown;
    place_formatted?: unknown;
  };
};

type GeocodingResponse = {
  features?: GeocodingFeature[];
  message?: unknown;
};

function parsePosition(value: unknown, sourceName: string): Position {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !value.every((coordinate) => typeof coordinate === "number")
  ) {
    throw new Error(`${sourceName} contains an invalid coordinate.`);
  }

  return value as Position;
}

function closeRing(coordinates: unknown, sourceName: string): Position[] {
  if (!Array.isArray(coordinates)) {
    throw new Error(`${sourceName} contains an invalid boundary.`);
  }

  const ring = coordinates.map((coordinate) =>
    parsePosition(coordinate, sourceName),
  );

  if (ring.length < 3) {
    throw new Error(`${sourceName} needs at least three boundary coordinates.`);
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }

  return ring;
}

function normalizeGeometry(
  feature: RawFeature,
  sourceName: string,
): PlotGeometry {
  const geometry = feature.geometry;

  if (!geometry) {
    throw new Error(`${sourceName} contains a feature without geometry.`);
  }

  if (geometry.type === "LineString") {
    return {
      type: "Polygon",
      coordinates: [closeRing(geometry.coordinates, sourceName)],
    };
  }

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) =>
        closeRing(ring, sourceName),
      ),
    };
  }

  if (
    geometry.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates)
  ) {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) => {
        if (!Array.isArray(polygon)) {
          throw new Error(`${sourceName} contains an invalid multipolygon.`);
        }

        return polygon.map((ring) => closeRing(ring, sourceName));
      }),
    };
  }

  throw new Error(
    `${sourceName} must contain LineString, Polygon, or MultiPolygon plot boundaries.`,
  );
}

async function loadPlotBoundaries(
  signal: AbortSignal,
): Promise<PlotFeatureCollection> {
  const collections = await Promise.all(
    plotGeoJsonUrls.map(async (url) => {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(
          `Could not load ${url} (${response.status} ${response.statusText}).`,
        );
      }

      return {
        url,
        data: (await response.json()) as RawFeatureCollection,
      };
    }),
  );

  const features = collections.flatMap(({ url, data }, fileIndex) => {
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error(`${url} is not a valid GeoJSON FeatureCollection.`);
    }

    return data.features.map((value, featureIndex) => {
      const feature = value as RawFeature;
      const name = feature.properties?.name;

      if (
        feature.type !== "Feature" ||
        typeof name !== "string" ||
        !name.trim()
      ) {
        throw new Error(`${url} contains a plot without a valid name.`);
      }

      return {
        type: "Feature" as const,
        id: `${fileIndex}-${featureIndex}`,
        properties: { name: name.trim() },
        geometry: normalizeGeometry(feature, url),
      };
    });
  });

  if (features.length === 0) {
    throw new Error("The plot GeoJSON files do not contain any features.");
  }

  return { type: "FeatureCollection", features };
}

function getPlotBounds(plotData: PlotFeatureCollection) {
  const bounds = new mapboxgl.LngLatBounds();

  function extendBounds(value: unknown) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.extend([value[0], value[1]]);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(extendBounds);
    }
  }

  plotData.features.forEach((feature) =>
    extendBounds(feature.geometry.coordinates),
  );

  return bounds;
}

export function FieldMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const addressSearchAbortControllerRef = useRef<AbortController | null>(null);
  const selectedFeatureIdRef = useRef<string | number | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSearchError, setAddressSearchError] = useState<string | null>(null);
  const [addressSearchResult, setAddressSearchResult] = useState<string | null>(null);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [selectedPlotName, setSelectedPlotName] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    const abortController = new AbortController();
    let active = true;
    let map: mapboxgl.Map | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeMap() {
      if (!accessToken) {
        setMapError(
          "Mapbox is not configured. Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to .env.local and restart the app.",
        );
        setIsLoading(false);
        return;
      }

      try {
        const plotData = await loadPlotBoundaries(abortController.signal);

        if (!active || !mapContainerRef.current) {
          return;
        }

        const plotBounds = getPlotBounds(plotData);
        const mapPadding =
          mapContainerRef.current.clientWidth <= 700 ? 28 : 64;

        map = new mapboxgl.Map({
          accessToken,
          container: mapContainerRef.current,
          style: "mapbox://styles/mapbox/satellite-streets-v12",
          bounds: plotBounds,
          fitBoundsOptions: {
            duration: 0,
            maxZoom: 15,
            padding: mapPadding,
          },
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
              ? `The Mapbox map could not be loaded: ${errorMessage}`
              : "A Mapbox resource could not be loaded. Check the public token permissions and network connection.",
          );
          setIsLoading(false);
        });

        map.on("load", () => {
          if (!map || !active) {
            return;
          }

          map.addSource(plotSourceId, {
            type: "geojson",
            data: plotData,
          } satisfies GeoJSONSourceSpecification);

          map.addLayer({
            id: plotFillLayerId,
            type: "fill",
            source: plotSourceId,
            paint: {
              "fill-color": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                "#f3d46b",
                "#b6d681",
              ],
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                0.62,
                0.3,
              ],
            },
          });

          map.addLayer({
            id: plotOutlineLayerId,
            type: "line",
            source: plotSourceId,
            paint: {
              "line-color": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                "#fff4bd",
                "#d9efad",
              ],
              "line-opacity": 0.95,
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                4,
                2,
              ],
            },
          });

          setMapError(null);
          setIsLoading(false);
        });

        map.on("click", plotFillLayerId, (event) => {
          if (!map) {
            return;
          }

          const feature = event.features?.[0];
          if (feature?.id === undefined) {
            return;
          }

          if (selectedFeatureIdRef.current !== null) {
            map.setFeatureState(
              { source: plotSourceId, id: selectedFeatureIdRef.current },
              { selected: false },
            );
          }

          selectedFeatureIdRef.current = feature.id;
          map.setFeatureState(
            { source: plotSourceId, id: feature.id },
            { selected: true },
          );
          setSelectedPlotName(String(feature.properties?.name ?? "Unnamed plot"));
        });

        map.on("mouseenter", plotFillLayerId, () => {
          if (map) {
            map.getCanvas().style.cursor = "pointer";
          }
        });

        map.on("mouseleave", plotFillLayerId, () => {
          if (map) {
            map.getCanvas().style.cursor = "";
          }
        });

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(mapContainerRef.current);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setMapError(
            error instanceof Error
              ? error.message
              : "The plot boundaries could not be loaded.",
          );
          setIsLoading(false);
        }
      }
    }

    void initializeMap();

    return () => {
      active = false;
      abortController.abort();
      addressSearchAbortControllerRef.current?.abort();
      resizeObserver?.disconnect();
      if (mapRef.current === map) {
        mapRef.current = null;
      }
      map?.remove();
    };
  }, []);

  async function handleAddressSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    const map = mapRef.current;
    const query = addressQuery.trim();

    if (!query || !map || !accessToken) {
      return;
    }

    addressSearchAbortControllerRef.current?.abort();
    const searchAbortController = new AbortController();
    addressSearchAbortControllerRef.current = searchAbortController;

    setAddressSearchError(null);
    setAddressSearchResult(null);
    setIsSearchingAddress(true);

    try {
      const searchParameters = new URLSearchParams({
        access_token: accessToken,
        autocomplete: "false",
        limit: "1",
        q: query,
        types: "address,place,postcode,locality",
      });
      const response = await fetch(
        `https://api.mapbox.com/search/geocode/v6/forward?${searchParameters.toString()}`,
        { signal: searchAbortController.signal },
      );
      const data = (await response.json()) as GeocodingResponse;

      if (!response.ok) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : `Address search failed (${response.status} ${response.statusText}).`,
        );
      }

      const result = data.features?.[0];
      const coordinates = result?.geometry?.coordinates;
      if (
        !Array.isArray(coordinates) ||
        coordinates.length < 2 ||
        typeof coordinates[0] !== "number" ||
        typeof coordinates[1] !== "number"
      ) {
        throw new Error("No matching address was found.");
      }

      const properties = result?.properties;
      const resultName =
        typeof properties?.full_address === "string"
          ? properties.full_address
          : [properties?.name, properties?.place_formatted]
              .filter((value): value is string => typeof value === "string")
              .join(", ");

      map.flyTo({
        center: [coordinates[0], coordinates[1]],
        duration: 1200,
        zoom: 17,
      });
      setAddressSearchResult(resultName || query);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setAddressSearchError(
          error instanceof Error ? error.message : "The address search failed.",
        );
      }
    } finally {
      if (addressSearchAbortControllerRef.current === searchAbortController) {
        addressSearchAbortControllerRef.current = null;
        setIsSearchingAddress(false);
      }
    }
  }

  return (
    <section aria-label="Interactive field map" className="field-workspace-map">
      <div
        aria-label="Satellite map of farm plot boundaries"
        className="field-map-canvas"
        ref={mapContainerRef}
      />

      {!mapError && !isLoading ? (
        <form
          aria-label="Search map by address"
          className="field-map-address-search"
          onSubmit={handleAddressSearch}
        >
          <label
            className="field-workspace-visually-hidden"
            htmlFor="field-map-address"
          >
            Farm address
          </label>
          <input
            autoComplete="street-address"
            id="field-map-address"
            maxLength={256}
            onChange={(event) => setAddressQuery(event.target.value)}
            placeholder="Search a farm address"
            type="search"
            value={addressQuery}
          />
          <button disabled={isSearchingAddress || !addressQuery.trim()} type="submit">
            {isSearchingAddress ? "Searching..." : "Search"}
          </button>
          {addressSearchError ? (
            <span className="field-map-address-feedback is-error" role="alert">
              {addressSearchError}
            </span>
          ) : null}
          {addressSearchResult ? (
            <span aria-live="polite" className="field-map-address-feedback">
              Showing {addressSearchResult}
            </span>
          ) : null}
        </form>
      ) : null}

      {isLoading ? (
        <div className="field-map-message" role="status">
          Loading plot boundaries�
        </div>
      ) : null}

      {mapError ? (
        <div className="field-map-message is-error" role="alert">
          <strong>Map unavailable</strong>
          <span>{mapError}</span>
        </div>
      ) : null}

      {!mapError && !isLoading ? (
        <div aria-live="polite" className="field-map-selection">
          <span>Selected plot</span>
          <strong>{selectedPlotName ?? "None"}</strong>
          <small>
            {selectedPlotName
              ? "The selected boundary is highlighted."
              : "Click a field boundary to inspect it."}
          </small>
        </div>
      ) : null}
    </section>
  );
}
