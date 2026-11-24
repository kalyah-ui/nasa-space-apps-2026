"use client";

import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { kml } from "@tmcw/togeojson";
import mapboxgl, {
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
  type ImageSourceSpecification,
  type MapboxErrorEvent,
} from "mapbox-gl";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  FieldGeometry,
  StoredFieldCollection,
  StoredFieldFeature,
} from "@/lib/fields/types";
import { loadDemoFieldCatalog, loadSavedFields, saveFieldForRotation, SELECTED_FIELD_STORAGE_KEY } from "@/lib/fields/field-catalog";
import { getAreaHectares, parseFieldGeometry } from "@/lib/fields/validation";
import { fieldDataProvider } from "./data/provider-config";
import type { FieldSpec, LayerId, MapOverlayData } from "./data/types";
import type { SoilCropId, SoilRegionCollection } from "./data/types";
import type { SoilRegionProperties } from "@/lib/soil/types";

const fieldSourceId = "farm-fields";
const fieldFillLayerId = "farm-fields-fill";
const fieldOutlineLayerId = "farm-fields-outline";
const elevationSourceId = "selected-field-elevation";
const elevationLayerId = "selected-field-elevation-raster";
const landsatSourceId = "selected-field-landsat";
const landsatLayerId = "selected-field-landsat-raster";
const soilSourceId = "regional-soil-suitability";
const soilFillLayerId = "regional-soil-suitability-fill";
const soilOutlineLayerId = "regional-soil-suitability-outline";

type FieldMapProps = {
  selectedLayerId: LayerId;
  onSelectField: (field: FieldSpec | null) => void;
};
type ElevationLegend = {
  min: number;
  max: number;
  units: "m";
  stops: Array<{ value: number; color: string }>;
};
type ApiErrorResponse = { message?: unknown };
type ElevationStatus =
  | { kind: "idle" }
  | { kind: "needs-field" }
  | { kind: "loading" }
  | { kind: "ready"; legend: ElevationLegend }
  | { kind: "error"; message: string };
type LandsatStatus =
  | { kind: "idle" }
  | { kind: "needs-field" }
  | { kind: "loading" }
  | { kind: "ready"; data: MapOverlayData }
  | { kind: "error"; message: string };
type SoilStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: SoilRegionCollection }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };
type SoilUploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };
type DraftField = { drawId: string; geometry: FieldGeometry };
type GeocodingFeature = {
  id?: unknown;
  geometry?: { coordinates?: unknown };
  properties?: {
    mapbox_id?: unknown;
    full_address?: unknown;
    name?: unknown;
    place_formatted?: unknown;
    match_code?: unknown;
  };
};
type GeocodingResponse = {
  features?: GeocodingFeature[];
  message?: unknown;
};
type AddressSuggestion = {
  id: string;
  label: string;
  coordinates: [longitude: number, latitude: number];
  confidence: string | null;
  approximate: boolean;
};

const addressSuggestionListId = "field-map-address-suggestions";

function applyFieldOutlineVisibility(map: mapboxgl.Map, visible: boolean) {
  if (map.getLayer(fieldOutlineLayerId)) {
    map.setLayoutProperty(fieldOutlineLayerId, "visibility", visible ? "visible" : "none");
  }
}

function getGeocodingLabel(feature: GeocodingFeature): string {
  const properties = feature.properties;
  return typeof properties?.full_address === "string"
    ? properties.full_address
    : [properties?.name, properties?.place_formatted]
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .join(", ");
}

function toAddressSuggestion(
  feature: GeocodingFeature,
  index: number,
): AddressSuggestion | null {
  const coordinates = feature.geometry?.coordinates;
  if (
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number"
  ) {
    return null;
  }
  const label = getGeocodingLabel(feature);
  if (!label) return null;

  const matchCode = feature.properties?.match_code;
  const confidence =
    matchCode &&
    typeof matchCode === "object" &&
    "confidence" in matchCode &&
    typeof (matchCode as { confidence?: unknown }).confidence === "string"
      ? (matchCode as { confidence: string }).confidence.toLowerCase()
      : null;
  const componentMatches =
    matchCode && typeof matchCode === "object"
      ? Object.entries(matchCode)
          .filter(([key]) => key !== "confidence")
          .map(([, value]) => value)
      : [];
  const approximate =
    confidence === "medium" ||
    confidence === "low" ||
    componentMatches.some(
      (value) => value === "inferred" || value === "plausible" || value === "unmatched",
    );
  const featureId = feature.properties?.mapbox_id ?? feature.id ?? `${label}-${index}`;
  return {
    id: String(featureId),
    label,
    coordinates: [coordinates[0], coordinates[1]],
    confidence,
    approximate,
  };
}

function getFieldBounds(field: StoredFieldFeature) {
  const bounds = new mapboxgl.LngLatBounds();
  function extend(value: unknown) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.extend([value[0], value[1]]);
    } else if (Array.isArray(value)) {
      value.forEach(extend);
    }
  }
  extend(field.geometry.coordinates);
  return bounds;
}
function getCollectionBounds(collection: StoredFieldCollection) {
  const bounds = new mapboxgl.LngLatBounds();
  collection.features.forEach((field) => {
    const fieldBounds = getFieldBounds(field);
    bounds.extend(fieldBounds.getSouthWest());
    bounds.extend(fieldBounds.getNorthEast());
  });
  return bounds;
}

function removeElevationOverlay(map: mapboxgl.Map) {
  if (map.getLayer(elevationLayerId)) map.removeLayer(elevationLayerId);
  if (map.getSource(elevationSourceId)) map.removeSource(elevationSourceId);
}

function removeLandsatOverlay(map: mapboxgl.Map) {
  if (map.getLayer(landsatLayerId)) map.removeLayer(landsatLayerId);
  if (map.getSource(landsatSourceId)) map.removeSource(landsatSourceId);
}

function removeSoilOverlay(map: mapboxgl.Map) {
  if (map.getLayer(soilOutlineLayerId)) map.removeLayer(soilOutlineLayerId);
  if (map.getLayer(soilFillLayerId)) map.removeLayer(soilFillLayerId);
  if (map.getSource(soilSourceId)) map.removeSource(soilSourceId);
}

function getErrorMessage(data: unknown, fallback: string): string {
  return data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as ApiErrorResponse).message === "string"
    ? (data as { message: string }).message
    : fallback;
}

function isFieldGeometry(value: unknown): value is FieldGeometry {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    ((value as { type?: unknown }).type === "Polygon" ||
      (value as { type?: unknown }).type === "MultiPolygon")
  );
}

async function loadFields(signal?: AbortSignal): Promise<StoredFieldCollection> {
  const collection = await fieldDataProvider.listFields(signal);
  const savedNames = new Map(loadSavedFields().map((field) => [field.id, field.name]));
  return {
    ...collection,
    features: collection.features.map((field) => {
      const name = savedNames.get(field.id);
      return name ? { ...field, properties: { ...field.properties, name } } : field;
    }),
  };
}

function toFieldSpec(field: StoredFieldFeature, isDemo = false): FieldSpec {
  return {
    id: field.id,
    name: field.properties.name,
    area: field.properties.areaHectares,
    areaUnit: "ha",
    boundary: field.geometry,
    provenance: isDemo ? { kind: "demo", label: "Demo field boundary" } : { kind: "live", label: "AAFC field boundary" },
    healthScore: {
      value: 0,
      label: "Not calculated",
      note: "No composite field score is calculated for this live field.",
      subScores: [],
    },
  };
}

export function FieldMap({ selectedLayerId, onSelectField }: FieldMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const soilInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const fieldsRef = useRef<StoredFieldCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const demoFieldsRef = useRef(false);
  const selectedFieldRef = useRef<StoredFieldFeature | null>(null);
  const selectedFeatureIdRef = useRef<string | null>(null);
  const fieldOutlinesVisibleRef = useRef(true);
  const editingDrawIdRef = useRef<string | null>(null);
  const addressSearchAbortControllerRef = useRef<AbortController | null>(null);
  const skipNextAddressAutocompleteRef = useRef(false);
  const elevationAbortControllerRef = useRef<AbortController | null>(null);
  const landsatAbortControllerRef = useRef<AbortController | null>(null);
  const soilAbortControllerRef = useRef<AbortController | null>(null);

  const [addressQuery, setAddressQuery] = useState("");
  const [addressSearchError, setAddressSearchError] = useState<string | null>(null);
  const [addressSearchResult, setAddressSearchResult] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeAddressSuggestion, setActiveAddressSuggestion] = useState(-1);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [isLoadingAddressSuggestions, setIsLoadingAddressSuggestions] = useState(false);
  const [fieldOutlinesVisible, setFieldOutlinesVisible] = useState(true);
  const [fields, setFields] = useState<StoredFieldCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const [selectedField, setSelectedField] = useState<StoredFieldFeature | null>(null);
  const [fieldToSave, setFieldToSave] = useState<StoredFieldFeature | null>(null);
  const [fieldSaveName, setFieldSaveName] = useState("");
  const [draftField, setDraftField] = useState<DraftField | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isEditingBoundary, setIsEditingBoundary] = useState(false);
  const [isSavingField, setIsSavingField] = useState(false);
  const [fieldToolError, setFieldToolError] = useState<string | null>(null);
  const [fieldToolMessage, setFieldToolMessage] = useState<string | null>(null);
  const [elevationStatus, setElevationStatus] = useState<ElevationStatus>({ kind: "idle" });
  const [landsatStatus, setLandsatStatus] = useState<LandsatStatus>({ kind: "idle" });
  const [soilStatus, setSoilStatus] = useState<SoilStatus>({ kind: "idle" });
  const [soilCrop, setSoilCrop] = useState<SoilCropId>("corn");
  const [selectedSoilRegion, setSelectedSoilRegion] =
    useState<SoilRegionProperties | null>(null);
  const [soilUploadStatus, setSoilUploadStatus] = useState<SoilUploadStatus>({
    kind: "idle",
  });
  const [soilViewportRevision, setSoilViewportRevision] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [fieldLoadError, setFieldLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);

  function updateFieldSource(collection: StoredFieldCollection) {
    fieldsRef.current = collection;
    setFields(collection);
    const source = mapRef.current?.getSource(fieldSourceId) as GeoJSONSource | undefined;
    source?.setData(collection);
  }

  function clearSelection() {
    const map = mapRef.current;
    if (map && selectedFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: fieldSourceId, id: selectedFeatureIdRef.current },
        { selected: false },
      );
    }
    selectedFeatureIdRef.current = null;
    selectedFieldRef.current = null;
    setSelectedField(null);
    window.sessionStorage.removeItem(SELECTED_FIELD_STORAGE_KEY);
    window.localStorage.removeItem(SELECTED_FIELD_STORAGE_KEY);
    onSelectField(null);
  }

  function selectField(field: StoredFieldFeature, zoom = true) {
    const map = mapRef.current;
    if (!map) return;
    if (selectedFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: fieldSourceId, id: selectedFeatureIdRef.current },
        { selected: false },
      );
    }
    selectedFeatureIdRef.current = field.id;
    selectedFieldRef.current = field;
    setSelectedField(field);
    window.localStorage.setItem(SELECTED_FIELD_STORAGE_KEY, field.id);
    onSelectField(toFieldSpec(field, demoFieldsRef.current));
    map.setFeatureState(
      { source: fieldSourceId, id: field.id },
      { selected: true },
    );
    if (zoom) {
      map.fitBounds(getFieldBounds(field), {
        duration: 700,
        maxZoom: 17,
        padding:
          mapContainerRef.current?.clientWidth &&
          mapContainerRef.current.clientWidth <= 700
            ? 42
            : 90,
      });
    }
  }

  async function refreshFields(preferredId?: string) {
    const collection = await loadFields();
    updateFieldSource(collection);
    if (preferredId) {
      const preferred = collection.features.find((field) => field.id === preferredId);
      if (preferred) selectField(preferred, false);
    }
    return collection;
  }

  useEffect(() => {
    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const abortController = new AbortController();
    let active = true;
    let map: mapboxgl.Map | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeMap() {
      if (!accessToken) {
        setMapError(
          "Mapbox is not configured. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN and restart the app.",
        );
        setIsLoading(false);
        return;
      }

      try {
        let collection: StoredFieldCollection;
        try {
          collection = await loadFields(abortController.signal);
          demoFieldsRef.current = false;
          if (active) setFieldLoadError(null);
        } catch {
          if (abortController.signal.aborted) return;
          const demoFields = await loadDemoFieldCatalog(abortController.signal);
          collection = {
            type: "FeatureCollection",
            features: demoFields.map((field) => {
              const geometry = parseFieldGeometry(field.geometry);
              return { type: "Feature", id: field.id, properties: { name: field.name, areaHectares: getAreaHectares(geometry) }, geometry };
            }),
          };
          demoFieldsRef.current = true;
          if (active) setFieldLoadError("Saved fields are unavailable. Showing read-only demo boundaries.");
        }
        if (!active || !mapContainerRef.current) return;
        fieldsRef.current = collection;
        setFields(collection);
        const bounds = getCollectionBounds(collection);
        const hasFields = collection.features.length > 0 && !bounds.isEmpty();

        map = new mapboxgl.Map({
          accessToken,
          container: mapContainerRef.current,
          style: "mapbox://styles/mapbox/satellite-streets-v12",
          ...(hasFields
            ? {
                bounds,
                fitBoundsOptions: {
                  duration: 0,
                  maxZoom: 15,
                  padding: mapContainerRef.current.clientWidth <= 700 ? 28 : 64,
                },
              }
            : { center: [-76.297, 45.308] as [number, number], zoom: 12 }),
          attributionControl: true,
        });
        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl(), "top-right");

        const draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: {},
          userProperties: true,
        });
        drawRef.current = draw;
        map.addControl(draw, "top-right");

        map.on("error", (event: MapboxErrorEvent) => {
          if (!active) return;
          const message = event.error?.message?.trim();
          setMapError(
            message
              ? `The Mapbox map could not be loaded: ${message}`
              : "A Mapbox resource could not be loaded. Check the public token permissions and network connection.",
          );
          setIsLoading(false);
        });

        map.on("click", (event) => {
          if (map?.getLayer(soilFillLayerId)) {
            const renderedSoil = map.queryRenderedFeatures(event.point, {
              layers: [soilFillLayerId],
            })[0];
            if (renderedSoil?.properties) {
              const properties = renderedSoil.properties as Record<string, unknown>;
              try {
                const region = {
                  ...properties,
                  limitingFactors:
                    typeof properties.limitingFactors === "string"
                      ? JSON.parse(properties.limitingFactors)
                      : properties.limitingFactors,
                  components:
                    typeof properties.components === "string"
                      ? JSON.parse(properties.components)
                      : properties.components,
                  bbox:
                    typeof properties.bbox === "string"
                      ? JSON.parse(properties.bbox)
                      : properties.bbox,
                } as SoilRegionProperties;
                setSelectedSoilRegion((current) =>
                  current?.polyId === region.polyId ? null : region,
                );
              } catch {
                setSelectedSoilRegion(null);
              }
            }
          }
          if (!map?.getLayer(fieldFillLayerId)) return;
          if (draw.getMode() !== "simple_select") return;

          const renderedField = map.queryRenderedFeatures(event.point, {
            layers: [fieldFillLayerId],
          })[0];
          const id = renderedField?.id;
          const name = renderedField?.properties?.name;
          const field = fieldsRef.current.features.find(
            (candidate) =>
              (id !== undefined && String(candidate.id) === String(id)) ||
              (typeof name === "string" && candidate.properties.name === name),
          );
          if (field) {
            if (selectedFeatureIdRef.current === field.id) {
              clearSelection();
              setSelectedSoilRegion(null);
              setFieldToSave(null);
              setFieldSaveName("");
              return;
            }
            selectField(field);
          }
        });

        map.on("style.load", () => {
          if (!map || !active) return;
          if (map.getSource(fieldSourceId)) return;
          map.addSource(fieldSourceId, {
            type: "geojson",
            data: fieldsRef.current,
          } satisfies GeoJSONSourceSpecification);
          map.addLayer({
            id: fieldFillLayerId,
            type: "fill",
            source: fieldSourceId,
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
                0.42,
                0.25,
              ],
            },
          });
          map.addLayer({
            id: fieldOutlineLayerId,
            type: "line",
            source: fieldSourceId,
            paint: {
              "line-color": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                "#fff4bd",
                "#d9efad",
              ],
              "line-opacity": 0.98,
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                4,
                2,
              ],
            },
          });
          applyFieldOutlineVisibility(map, fieldOutlinesVisibleRef.current);
          if (selectedFeatureIdRef.current !== null) {
            map.setFeatureState(
              { source: fieldSourceId, id: selectedFeatureIdRef.current },
              { selected: true },
            );
          }
          map.on("mouseenter", fieldFillLayerId, () => {
            if (draw.getMode() === "simple_select") {
              map?.getCanvas().style.setProperty("cursor", "pointer");
            }
          });
          map.on("mouseleave", fieldFillLayerId, () => {
            map?.getCanvas().style.removeProperty("cursor");
          });
          setMapError(null);
          setIsLoading(false);
          setIsMapReady(true);
        });
        map.on("draw.create", (event: MapboxDraw.DrawCreateEvent) => {
          const created = event.features[0];
          if (!created?.id || !isFieldGeometry(created.geometry)) {
            draw.deleteAll();
            setFieldToolError("Only polygon fields can be created.");
            return;
          }
          setDraftField({ drawId: String(created.id), geometry: created.geometry });
          setDraftName(`Field ${fieldsRef.current.features.length + 1}`);
          setFieldToolError(null);
          setFieldToolMessage(null);
        });
        map.on("moveend", () => {
          if (active) setSoilViewportRevision((value) => value + 1);
        });

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(mapContainerRef.current);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setMapError(
            error instanceof Error
              ? error.message
              : "The field boundaries could not be loaded.",
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
      elevationAbortControllerRef.current?.abort();
      landsatAbortControllerRef.current?.abort();
      soilAbortControllerRef.current?.abort();
      resizeObserver?.disconnect();
      drawRef.current = null;
      if (mapRef.current === map) mapRef.current = null;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    fieldOutlinesVisibleRef.current = fieldOutlinesVisible;
    const map = mapRef.current;
    if (map && isMapReady) {
      applyFieldOutlineVisibility(map, fieldOutlinesVisible);
    }
  }, [fieldOutlinesVisible, isMapReady]);

  useEffect(() => {
    if (skipNextAddressAutocompleteRef.current) {
      skipNextAddressAutocompleteRef.current = false;
      return;
    }
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    const query = addressQuery.trim();
    const map = mapRef.current;
    if (!token || !map || query.length < 3) {
      addressSearchAbortControllerRef.current?.abort();
      setAddressSuggestions([]);
      setActiveAddressSuggestion(-1);
      setIsLoadingAddressSuggestions(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      addressSearchAbortControllerRef.current?.abort();
      const controller = new AbortController();
      addressSearchAbortControllerRef.current = controller;
      const center = map.getCenter();
      const parameters = new URLSearchParams({
        access_token: token,
        autocomplete: "true",
        country: "ca",
        language: "en",
        limit: "5",
        proximity: `${center.lng},${center.lat}`,
        q: query,
        types: "address,street,place,postcode,locality",
      });
      setIsLoadingAddressSuggestions(true);
      setAddressSearchError(null);
      void fetch(
        `https://api.mapbox.com/search/geocode/v6/forward?${parameters.toString()}`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          const data = (await response.json()) as GeocodingResponse;
          if (!response.ok) {
            throw new Error(
              typeof data.message === "string" ? data.message : "Address suggestions failed.",
            );
          }
          const suggestions = (data.features ?? []).flatMap((feature, index) => {
            const suggestion = toAddressSuggestion(feature, index);
            return suggestion ? [suggestion] : [];
          });
          setAddressSuggestions(suggestions);
          setActiveAddressSuggestion(suggestions.length > 0 ? 0 : -1);
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setAddressSuggestions([]);
            setActiveAddressSuggestion(-1);
            setAddressSearchError(
              error instanceof Error ? error.message : "Address suggestions failed.",
            );
          }
        })
        .finally(() => {
          if (addressSearchAbortControllerRef.current === controller) {
            addressSearchAbortControllerRef.current = null;
            setIsLoadingAddressSuggestions(false);
          }
        });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [addressQuery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    const activeMap = map;
    elevationAbortControllerRef.current?.abort();
    removeElevationOverlay(activeMap);
    if (selectedLayerId !== "elevation") {
      setElevationStatus({ kind: "idle" });
      return;
    }
    if (!selectedField) {
      setElevationStatus({ kind: "needs-field" });
      return;
    }

    const controller = new AbortController();
    elevationAbortControllerRef.current = controller;
    setElevationStatus({ kind: "loading" });
    async function loadElevationOverlay() {
      try {
        const data = await fieldDataProvider.getMapOverlay(
          selectedField as StoredFieldFeature,
          "elevation",
          controller.signal,
        );
        if (controller.signal.aborted) return;
        removeElevationOverlay(activeMap);
        activeMap.addSource(elevationSourceId, {
          type: "image",
          url: data.image,
          coordinates: data.coordinates,
        } satisfies ImageSourceSpecification);
        activeMap.addLayer(
          {
            id: elevationLayerId,
            type: "raster",
            source: elevationSourceId,
            paint: {
              "raster-opacity": 0.9,
              "raster-fade-duration": 0,
              "raster-resampling": "linear",
            },
          },
          fieldOutlineLayerId,
        );
        if (!data.legend) throw new Error("The elevation legend is unavailable.");
        setElevationStatus({ kind: "ready", legend: data.legend as ElevationLegend });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          removeElevationOverlay(activeMap);
          setElevationStatus({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Elevation could not be loaded.",
          });
        }
      }
    }
    void loadElevationOverlay();
    return () => controller.abort();
  }, [isMapReady, selectedField, selectedLayerId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    const activeMap = map;
    soilAbortControllerRef.current?.abort();
    removeSoilOverlay(activeMap);
    setSelectedSoilRegion(null);
    if (selectedLayerId !== "productivity") {
      setSoilStatus({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    soilAbortControllerRef.current = controller;
    const bounds = activeMap.getBounds();
    const viewport: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    setSoilStatus({ kind: "loading" });

    async function loadSoilRegions() {
      try {
        const data = await fieldDataProvider.getSoilRegions(
          viewport,
          soilCrop,
          selectedField,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (data.features.length === 0) {
          setSoilStatus({
            kind: "empty",
            message: "No prepared CanSIS SLC regions intersect the current map view.",
          });
          return;
        }
        activeMap.addSource(soilSourceId, {
          type: "geojson",
          data,
        } satisfies GeoJSONSourceSpecification);
        activeMap.addLayer(
          {
            id: soilFillLayerId,
            type: "fill",
            source: soilSourceId,
            paint: {
              "fill-color": [
                "match",
                ["get", "rating"],
                "Good",
                "#4f9f62",
                "Moderate",
                "#e0b84f",
                "Limited",
                "#c9654f",
                "Insufficient data",
                "#8b8f91",
                "#8b8f91",
              ],
              "fill-opacity": 0.58,
            },
          },
          fieldFillLayerId,
        );
        activeMap.addLayer(
          {
            id: soilOutlineLayerId,
            type: "line",
            source: soilSourceId,
            paint: {
              "line-color": "#f6f1de",
              "line-opacity": 0.72,
              "line-width": 1.2,
            },
          },
          fieldFillLayerId,
        );
        if (selectedField) {
          const primaryRegion = [...data.features]
            .filter((feature) => (feature.properties.overlapPercent ?? 0) > 0)
            .sort(
              (first, second) =>
                (second.properties.overlapPercent ?? 0) -
                (first.properties.overlapPercent ?? 0),
            )[0];
          setSelectedSoilRegion(primaryRegion?.properties ?? null);
        }
        setSoilStatus({ kind: "ready", data });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          removeSoilOverlay(activeMap);
          setSoilStatus({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Regional soil suitability could not be loaded.",
          });
        }
      }
    }

    void loadSoilRegions();
    return () => controller.abort();
  }, [
    isMapReady,
    selectedField,
    selectedLayerId,
    soilCrop,
    soilViewportRevision,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    const activeMap = map;
    landsatAbortControllerRef.current?.abort();
    removeLandsatOverlay(activeMap);
    if (selectedLayerId !== "satellite" && selectedLayerId !== "ndvi") {
      setLandsatStatus({ kind: "idle" });
      return;
    }
    if (!selectedField) {
      setLandsatStatus({ kind: "needs-field" });
      return;
    }

    const controller = new AbortController();
    landsatAbortControllerRef.current = controller;
    setLandsatStatus({ kind: "loading" });
    async function loadLandsatOverlay() {
      try {
        const overlay = await fieldDataProvider.getMapOverlay(
          selectedField as StoredFieldFeature,
          selectedLayerId as "satellite" | "ndvi",
          controller.signal,
        );
        if (controller.signal.aborted) return;
        activeMap.addSource(landsatSourceId, {
          type: "image",
          url: overlay.image,
          coordinates: overlay.coordinates,
        } satisfies ImageSourceSpecification);
        activeMap.addLayer(
          {
            id: landsatLayerId,
            type: "raster",
            source: landsatSourceId,
            paint: {
              "raster-opacity": selectedLayerId === "ndvi" ? 0.88 : 1,
              "raster-fade-duration": 0,
              "raster-resampling": "nearest",
            },
          },
          fieldOutlineLayerId,
        );
        setLandsatStatus({ kind: "ready", data: overlay });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          removeLandsatOverlay(activeMap);
          setLandsatStatus({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Landsat imagery could not be loaded.",
          });
        }
      }
    }
    void loadLandsatOverlay();
    return () => controller.abort();
  }, [isMapReady, selectedField, selectedLayerId]);

  function cancelBoundaryEdit() {
    const drawId = editingDrawIdRef.current;
    if (drawId) drawRef.current?.delete(drawId);
    editingDrawIdRef.current = null;
    setIsEditingBoundary(false);
    drawRef.current?.changeMode("simple_select");
  }

  function beginAddField() {
    const draw = drawRef.current;
    if (!draw) return;
    cancelBoundaryEdit();
    setDraftField(null);
    setDraftName("");
    setFieldToolError(null);
    setFieldToolMessage(
      "Click the map to draw the field. Double-click the final point to finish.",
    );
    draw.changeMode("draw_polygon");
  }

  function cancelDraft() {
    if (draftField) drawRef.current?.delete(draftField.drawId);
    drawRef.current?.changeMode("simple_select");
    setDraftField(null);
    setDraftName("");
    setFieldToolMessage(null);
  }

  async function saveDraftField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftField) return;
    setIsSavingField(true);
    setFieldToolError(null);
    try {
      const response = await fetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName, geometry: draftField.geometry }),
      });
      const data = (await response.json()) as StoredFieldFeature | ApiErrorResponse;
      if (!response.ok || !("id" in data)) {
        throw new Error(getErrorMessage(data, "The field could not be saved."));
      }
      drawRef.current?.delete(draftField.drawId);
      drawRef.current?.changeMode("simple_select");
      setDraftField(null);
      setDraftName("");
      const collection = await refreshFields(data.id);
      const created = collection.features.find((field) => field.id === data.id);
      if (created) selectField(created);
      setFieldToolMessage("Field saved.");
    } catch (error) {
      setFieldToolError(
        error instanceof Error ? error.message : "The field could not be saved.",
      );
    } finally {
      setIsSavingField(false);
    }
  }

  async function updateStoredField(
    id: string,
    updates: { name?: string; geometry?: FieldGeometry },
    successMessage: string,
  ) {
    setIsSavingField(true);
    setFieldToolError(null);
    try {
      const response = await fetch(`/api/fields/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = (await response.json()) as StoredFieldFeature | ApiErrorResponse;
      if (!response.ok || !("id" in data)) {
        throw new Error(getErrorMessage(data, "The field could not be updated."));
      }
      await refreshFields(data.id);
      setFieldToolMessage(successMessage);
    } catch (error) {
      setFieldToolError(
        error instanceof Error ? error.message : "The field could not be updated.",
      );
    } finally {
      setIsSavingField(false);
    }
  }

  function beginBoundaryEdit() {
    if (!selectedField || !drawRef.current) return;
    cancelDraft();
    const [drawId] = drawRef.current.add({
      type: "Feature",
      properties: {},
      geometry: selectedField.geometry,
    });
    editingDrawIdRef.current = drawId;
    setIsEditingBoundary(true);
    setFieldToolError(null);
    setFieldToolMessage("Drag vertices to edit the field, then save changes.");
    drawRef.current.changeMode("direct_select", { featureId: drawId });
  }

  async function saveBoundaryEdit() {
    const field = selectedFieldRef.current;
    const drawId = editingDrawIdRef.current;
    const feature = drawId ? drawRef.current?.get(drawId) : undefined;
    if (!field || !feature || !isFieldGeometry(feature.geometry)) return;
    await updateStoredField(
      field.id,
      { geometry: feature.geometry },
      "Field boundary updated.",
    );
    cancelBoundaryEdit();
  }

  async function renameSelectedField() {
    if (!selectedField) return;
    const existing = loadSavedFields().find((saved) => saved.id === selectedField.id);
    setFieldToSave(selectedField);
    setFieldSaveName(existing?.name ?? selectedField.properties.name);
  }

  function saveSelectedFieldForRotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fieldSaveName.trim();
    if (!fieldToSave || !name) return;
    saveFieldForRotation({
      id: fieldToSave.id,
      name,
      geometry: fieldToSave.geometry,
    });
    const renamedField = {
      ...fieldToSave,
      properties: { ...fieldToSave.properties, name },
    };
    updateFieldSource({
      ...fieldsRef.current,
      features: fieldsRef.current.features.map((field) =>
        field.id === renamedField.id ? renamedField : field,
      ),
    });
    selectField(renamedField, false);
    setFieldToSave(null);
    setFieldSaveName("");
    setFieldToolError(null);
    setFieldToolMessage(`${name} was saved for Field Info and Crop Rotation.`);
  }

  function cancelFieldSave() {
    setFieldToSave(null);
    setFieldSaveName("");
  }

  async function deleteSelectedField() {
    if (
      !selectedField ||
      !window.confirm(`Delete ?${selectedField.properties.name}??`)
    ) {
      return;
    }
    setIsSavingField(true);
    setFieldToolError(null);
    try {
      const response = await fetch(
        `/api/fields/${encodeURIComponent(selectedField.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = (await response.json()) as ApiErrorResponse;
        throw new Error(getErrorMessage(data, "The field could not be deleted."));
      }
      clearSelection();
      await refreshFields();
      setFieldToolMessage("Field deleted.");
    } catch (error) {
      setFieldToolError(
        error instanceof Error ? error.message : "The field could not be deleted.",
      );
    } finally {
      setIsSavingField(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsSavingField(true);
    setFieldToolError(null);
    setFieldToolMessage(null);
    try {
      const text = await file.text();
      const imported = file.name.toLocaleLowerCase().endsWith(".kml")
        ? kml(new DOMParser().parseFromString(text, "text/xml"), {
            skipNullGeometry: true,
          })
        : JSON.parse(text);
      const candidateFeatures =
        imported.type === "FeatureCollection"
          ? imported.features
          : imported.type === "Feature"
            ? [imported]
            : [{ type: "Feature", properties: {}, geometry: imported }];
      const polygonFeatures = candidateFeatures.filter(
        (feature: { geometry?: { type?: unknown } | null }) =>
          feature.geometry?.type === "Polygon" ||
          feature.geometry?.type === "MultiPolygon",
      );
      if (polygonFeatures.length === 0) {
        throw new Error(
          "The file does not contain any Polygon or MultiPolygon boundaries.",
        );
      }

      let lastCreatedId: string | undefined;
      for (let index = 0; index < polygonFeatures.length; index += 1) {
        const feature = polygonFeatures[index] as {
          properties?: Record<string, unknown> | null;
          geometry: FieldGeometry;
        };
        const importedName =
          typeof feature.properties?.name === "string"
            ? feature.properties.name
            : `${file.name.replace(/\.(geojson|json|kml)$/i, "")} ${index + 1}`;
        const response = await fetch("/api/fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: importedName, geometry: feature.geometry }),
        });
        const data = (await response.json()) as StoredFieldFeature | ApiErrorResponse;
        if (!response.ok || !("id" in data)) {
          throw new Error(
            getErrorMessage(data, `Could not import polygon ${index + 1}.`),
          );
        }
        lastCreatedId = data.id;
      }

      const collection = await refreshFields(lastCreatedId);
      const lastCreated = collection.features.find(
        (field) => field.id === lastCreatedId,
      );
      if (lastCreated) selectField(lastCreated);
      setFieldToolMessage(
        `Imported ${polygonFeatures.length} field${polygonFeatures.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setFieldToolError(
        error instanceof Error
          ? error.message
          : "The boundary file could not be imported.",
      );
    } finally {
      setIsSavingField(false);
    }
  }

  function handleSoilUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setSoilUploadStatus({ kind: "error", message: "Only CSV files are accepted." });
      return;
    }

    const form = new FormData();
    form.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/soil-upload");
    request.responseType = "json";
    request.upload.onprogress = (progressEvent) => {
      if (!progressEvent.lengthComputable) return;
      setSoilUploadStatus({
        kind: "uploading",
        percent: Math.round((progressEvent.loaded / progressEvent.total) * 100),
      });
    };
    request.onload = () => {
      const data = request.response as ApiErrorResponse | null;
      if (request.status >= 200 && request.status < 300) {
        setSoilUploadStatus({
          kind: "success",
          message: `${file.name} was stored successfully.`,
        });
      } else {
        setSoilUploadStatus({
          kind: "error",
          message: getErrorMessage(data, "The soil CSV could not be stored."),
        });
      }
    };
    request.onerror = () => {
      setSoilUploadStatus({
        kind: "error",
        message: "The soil CSV upload failed before storage was confirmed.",
      });
    };
    setSoilUploadStatus({ kind: "uploading", percent: 0 });
    request.send(form);
  }

  function showAddressSuggestion(suggestion: AddressSuggestion) {
    const map = mapRef.current;
    if (!map) return;
    addressSearchAbortControllerRef.current?.abort();
    skipNextAddressAutocompleteRef.current = true;
    setAddressQuery(suggestion.label);
    setAddressSuggestions([]);
    setActiveAddressSuggestion(-1);
    setAddressSearchError(null);
    setAddressSearchResult(suggestion.label);
    setIsLoadingAddressSuggestions(false);
    map.flyTo({
      center: suggestion.coordinates,
      duration: 1200,
      zoom: 17,
    });
  }

  function handleAddressInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (addressSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveAddressSuggestion((current) =>
        current >= addressSuggestions.length - 1 ? 0 : current + 1,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveAddressSuggestion((current) =>
        current <= 0 ? addressSuggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeAddressSuggestion >= 0) {
      event.preventDefault();
      showAddressSuggestion(addressSuggestions[activeAddressSuggestion]);
    } else if (event.key === "Escape") {
      setAddressSuggestions([]);
      setActiveAddressSuggestion(-1);
    }
  }

  async function handleAddressSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const map = mapRef.current;
    const query = addressQuery.trim();
    if (!query || !map || !token) return;

    addressSearchAbortControllerRef.current?.abort();
    const controller = new AbortController();
    addressSearchAbortControllerRef.current = controller;
    setAddressSearchError(null);
    setAddressSearchResult(null);
    setAddressSuggestions([]);
    setActiveAddressSuggestion(-1);
    setIsSearchingAddress(true);
    try {
      const parameters = new URLSearchParams({
        access_token: token,
        autocomplete: "false",
        limit: "1",
        q: query,
        types: "address,place,postcode,locality",
      });
      const response = await fetch(
        `https://api.mapbox.com/search/geocode/v6/forward?${parameters.toString()}`,
        { signal: controller.signal },
      );
      const data = (await response.json()) as GeocodingResponse;
      if (!response.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Address search failed.",
        );
      }
      const result = data.features?.[0];
      const coordinates = result?.geometry?.coordinates;
      if (
        !Array.isArray(coordinates) ||
        typeof coordinates[0] !== "number" ||
        typeof coordinates[1] !== "number"
      ) {
        throw new Error("No matching address was found.");
      }
      const properties = result?.properties;
      const label =
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
      skipNextAddressAutocompleteRef.current = true;
      setAddressQuery(label || query);
      setAddressSearchResult(label || query);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setAddressSearchError(
          error instanceof Error ? error.message : "The address search failed.",
        );
      }
    } finally {
      if (addressSearchAbortControllerRef.current === controller) {
        addressSearchAbortControllerRef.current = null;
        setIsSearchingAddress(false);
      }
    }
  }

  return (
    <section aria-label="Interactive field map" className="field-workspace-map">
      <div
        aria-label="Satellite map of farm field boundaries"
        className="field-map-canvas"
        ref={mapContainerRef}
      />

      {!mapError && !isLoading ? (
        <div className="field-map-top-controls">
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
              aria-activedescendant={
                activeAddressSuggestion >= 0
                  ? `field-map-address-suggestion-${activeAddressSuggestion}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={addressSuggestionListId}
              aria-expanded={addressSuggestions.length > 0}
              autoComplete="street-address"
              id="field-map-address"
              maxLength={256}
              onChange={(event) => {
                setAddressQuery(event.target.value);
                setAddressSearchResult(null);
              }}
              onKeyDown={handleAddressInputKeyDown}
              placeholder="Search a farm address"
              role="combobox"
              type="search"
              value={addressQuery}
            />
            <button
              disabled={isSearchingAddress || !addressQuery.trim()}
              type="submit"
            >
              {isSearchingAddress ? "Searching…" : "Search"}
            </button>
            {addressSuggestions.length > 0 ? (
              <div
                aria-label="Address suggestions"
                className="field-map-address-suggestions"
                id={addressSuggestionListId}
                role="listbox"
              >
                {addressSuggestions.map((suggestion, index) => (
                  <button
                    aria-selected={activeAddressSuggestion === index}
                    className={activeAddressSuggestion === index ? "is-active" : undefined}
                    id={`field-map-address-suggestion-${index}`}
                    key={suggestion.id}
                    onClick={() => showAddressSuggestion(suggestion)}
                    onMouseEnter={() => setActiveAddressSuggestion(index)}
                    role="option"
                    type="button"
                  >
                    <span>{suggestion.label}</span>
                    {suggestion.approximate ? (
                      <small>Approximate match</small>
                    ) : suggestion.confidence ? (
                      <small>{suggestion.confidence} confidence</small>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            {isLoadingAddressSuggestions && addressSuggestions.length === 0 ? (
              <span aria-live="polite" className="field-map-address-feedback">
                Finding address suggestions...
              </span>
            ) : null}
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

          <div aria-label="Field tools" className="field-map-field-tools">
            <button
              aria-checked={fieldOutlinesVisible}
              className="field-map-outline-toggle"
              onClick={() => setFieldOutlinesVisible((visible) => !visible)}
              role="switch"
              type="button"
            >
              <span>Field outlines</span>
              <span aria-hidden="true" className="field-map-switch-track">
                <span className="field-map-switch-thumb" />
              </span>
            </button>
            <button
              disabled={Boolean(fieldLoadError) || isSavingField || Boolean(draftField) || isEditingBoundary}
              onClick={beginAddField}
              type="button"
            >
              Add field
            </button>
            <button
              disabled={Boolean(fieldLoadError) || isSavingField}
              onClick={() => importInputRef.current?.click()}
              type="button"
            >
              Upload GeoJSON/KML
            </button>
            <input
              accept=".geojson,.json,.kml,application/geo+json,application/json,application/vnd.google-earth.kml+xml"
              className="field-workspace-visually-hidden"
              disabled={Boolean(fieldLoadError) || isSavingField}
              id="field-boundary-upload"
              name="field-boundary-upload"
              onChange={handleImport}
              ref={importInputRef}
              type="file"
            />
            <button
              disabled={soilUploadStatus.kind === "uploading"}
              onClick={() => soilInputRef.current?.click()}
              type="button"
            >
              {soilUploadStatus.kind === "uploading"
                ? `Uploading ${soilUploadStatus.percent}%`
                : "Upload soil data"}
            </button>
            <input
              accept=".csv,text/csv"
              className="field-workspace-visually-hidden"
              id="soil-data-upload"
              name="soil-data-upload"
              onChange={handleSoilUpload}
              ref={soilInputRef}
              type="file"
            />
            {fieldLoadError ? (
              <p className="field-map-field-warning" role="alert">{fieldLoadError}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="field-map-message" role="status">
          Loading field boundaries…
        </div>
      ) : null}
      {mapError ? (
        <div className="field-map-message is-error" role="alert">
          <strong>Map unavailable</strong>
          <span>{mapError}</span>
        </div>
      ) : null}


      {fieldToSave ? (
        <div className="field-map-save-dialog-backdrop">
          <form
            aria-labelledby="field-save-dialog-title"
            aria-modal="true"
            className="field-map-save-dialog"
            onSubmit={saveSelectedFieldForRotation}
            role="dialog"
          >
            <strong id="field-save-dialog-title">Save field as</strong>
            <label htmlFor="field-save-name">Enter the name of the field</label>
            <input
              autoFocus
              id="field-save-name"
              maxLength={100}
              onChange={(event) => setFieldSaveName(event.target.value)}
              placeholder="Field name"
              required
              value={fieldSaveName}
            />
            <small>
              This name will appear in Field Info and Crop Rotation for this browser session.
            </small>
            <div>
              <button type="submit">Save field</button>
              <button onClick={cancelFieldSave} type="button">Cancel</button>
            </div>
          </form>
        </div>
      ) : null}

      {draftField ? (
        <form className="field-map-draft-panel" onSubmit={saveDraftField}>
          <strong>Name this field</strong>
          <input
            autoFocus
            maxLength={100}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Field name"
            required
            value={draftName}
          />
          <div>
            <button disabled={isSavingField} type="submit">
              {isSavingField ? "Saving…" : "Save field"}
            </button>
            <button disabled={isSavingField} onClick={cancelDraft} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {fieldToolError || fieldToolMessage ? (
        <div
          aria-live="polite"
          className={`field-map-tool-feedback${fieldToolError ? " is-error" : ""}`}
          role={fieldToolError ? "alert" : "status"}
        >
          {fieldToolError ?? fieldToolMessage}
        </div>
      ) : null}

      {soilUploadStatus.kind === "success" || soilUploadStatus.kind === "error" ? (
        <div
          aria-live="polite"
          className={`field-map-soil-upload-feedback${
            soilUploadStatus.kind === "error" ? " is-error" : ""
          }`}
          role={soilUploadStatus.kind === "error" ? "alert" : "status"}
        >
          {soilUploadStatus.message}
        </div>
      ) : null}

      <div className="field-map-bottom-controls">
      {!mapError && !isLoading ? (
        <div aria-live="polite" className="field-map-selection">
          <span>Selected field</span>
          <strong>{selectedField?.properties.name ?? "None selected"}</strong>
          <small>
            {selectedField
              ? `${selectedField.properties.areaHectares.toFixed(2)} ha · Field ID ${selectedField.id}`
              : fields.features.length > 0
                ? "Click inside a field boundary to inspect it."
                : fieldLoadError
                  ? "Stored field boundaries are unavailable. You can still search an address or upload a boundary."
                  : "Add or upload a field boundary to begin."}
          </small>
          {selectedField ? (
            <div className="field-map-selection-actions">
              <button
                disabled={isSavingField || isEditingBoundary}
                onClick={renameSelectedField}
                type="button"
              >
                Save as
              </button>
              {!isEditingBoundary ? (
                <button
                  disabled={isSavingField}
                  onClick={beginBoundaryEdit}
                  type="button"
                >
                  Edit boundary
                </button>
              ) : (
                <>
                  <button
                    disabled={isSavingField}
                    onClick={saveBoundaryEdit}
                    type="button"
                  >
                    Save boundary
                  </button>
                  <button
                    disabled={isSavingField}
                    onClick={cancelBoundaryEdit}
                    type="button"
                  >
                    Cancel edit
                  </button>
                </>
              )}
              <button
                className="is-danger"
                disabled={isSavingField}
                onClick={deleteSelectedField}
                type="button"
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!mapError && selectedLayerId === "elevation" ? (
        <div
          aria-live="polite"
          className={`field-map-elevation-panel${
            elevationStatus.kind === "error" ? " is-error" : ""
          }`}
          role={elevationStatus.kind === "error" ? "alert" : "status"}
        >
          {elevationStatus.kind === "needs-field" ? (
            <span>Select a field to load elevation.</span>
          ) : null}
          {elevationStatus.kind === "loading" ? (
            <span>Loading SRTM elevation…</span>
          ) : null}
          {elevationStatus.kind === "error" ? (
            <span>{elevationStatus.message}</span>
          ) : null}
          {elevationStatus.kind === "ready" ? (
            <div className="field-map-elevation-legend">
              <strong>Elevation</strong>
              <span className="field-map-elevation-units">metres</span>
              <span
                aria-hidden="true"
                className="field-map-elevation-gradient"
                style={{
                  background: `linear-gradient(90deg, ${elevationStatus.legend.stops
                    .map((stop) => stop.color)
                    .join(", ")})`,
                }}
              />
              <span className="field-map-elevation-range">
                <span>{elevationStatus.legend.min} m</span>
                <span>{elevationStatus.legend.max} m</span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {!mapError && (selectedLayerId === "satellite" || selectedLayerId === "ndvi") ? (
        <div
          aria-live="polite"
          className={`field-map-elevation-panel field-map-landsat-panel${
            landsatStatus.kind === "error" ? " is-error" : ""
          }`}
          role={landsatStatus.kind === "error" ? "alert" : "status"}
        >
          {landsatStatus.kind === "needs-field" ? (
            <span>Select a field to load Landsat imagery.</span>
          ) : null}
          {landsatStatus.kind === "loading" ? (
            <span>Loading Landsat surface reflectance…</span>
          ) : null}
          {landsatStatus.kind === "error" ? <span>{landsatStatus.message}</span> : null}
          {landsatStatus.kind === "ready" ? (
            <div className="field-map-elevation-legend field-map-landsat-legend">
              <strong>{selectedLayerId === "ndvi" ? "NDVI" : "True colour"}</strong>
              <span className="field-map-elevation-units">{landsatStatus.data.imageDate}</span>
              {landsatStatus.data.legend ? (
                <>
                  <span
                    aria-hidden="true"
                    className="field-map-elevation-gradient"
                    style={{
                      background: `linear-gradient(90deg, ${landsatStatus.data.legend.stops
                        .map((stop) => stop.color)
                        .join(", ")})`,
                    }}
                  />
                  <span className="field-map-elevation-range">
                    <span>-1</span>
                    <span>0</span>
                    <span>1</span>
                  </span>
                </>
              ) : null}
              <span className="field-map-landsat-stat">
                Average NDVI: {landsatStatus.data.averageNdvi?.toFixed(3) ?? "Unavailable"}
              </span>
              <span className="field-map-landsat-stat">
                Clear pixels: {landsatStatus.data.clearPixelPercent.toFixed(1)}%
              </span>
              <span className="field-map-landsat-stat">
                QA masked: {landsatStatus.data.maskedPixelPercent.toFixed(1)}%
              </span>
              <span className="field-map-landsat-source">
                {landsatStatus.data.source} · {landsatStatus.data.sceneId}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {!mapError && selectedLayerId === "productivity" ? (
        <div
          aria-live="polite"
          className={`field-map-elevation-panel field-map-soil-panel${
            soilStatus.kind === "error" ? " is-error" : ""
          }`}
          role={soilStatus.kind === "error" ? "alert" : "status"}
        >
          <strong>Regional soil suitability — not measured productivity</strong>
          <label className="field-map-soil-crop">
            Crop
            <select
              onChange={(event) => setSoilCrop(event.target.value as SoilCropId)}
              value={soilCrop}
            >
              <option value="corn">Corn</option>
              <option value="soybean">Soybean</option>
              <option value="winter-wheat">Winter wheat</option>
              <option value="canola">Canola</option>
              <option value="forage">Forage</option>
            </select>
          </label>
          {soilStatus.kind === "loading" ? <span>Loading CanSIS regions…</span> : null}
          {soilStatus.kind === "empty" || soilStatus.kind === "error" ? (
            <span>{soilStatus.message}</span>
          ) : null}
          {soilStatus.kind === "ready" ? (
            <>
              <div className="field-map-soil-legend" aria-label="Suitability legend">
                {[
                  ["Good", "#4f9f62"],
                  ["Moderate", "#e0b84f"],
                  ["Limited", "#c9654f"],
                  ["Insufficient data", "#8b8f91"],
                ].map(([label, color]) => (
                  <span key={label}>
                    <i aria-hidden="true" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
              <small>
                AAFC CanSIS SLC v3.2 · 1:1,000,000 · Regional estimate, not a
                soil test
              </small>
              {selectedField ? (
                <div className="field-map-soil-overlaps">
                  <b>Regions within the selected field</b>
                  {soilStatus.data.features
                    .filter((feature) => (feature.properties.overlapPercent ?? 0) > 0)
                    .sort(
                      (first, second) =>
                        (second.properties.overlapPercent ?? 0) -
                        (first.properties.overlapPercent ?? 0),
                    )
                    .map((feature) => (
                      <button
                        key={feature.id}
                        onClick={() => setSelectedSoilRegion((current) =>
                          current?.polyId === feature.properties.polyId ? null : feature.properties,
                        )}
                        type="button"
                      >
                        {feature.properties.polyId}: {feature.properties.overlapPercent}% ·{" "}
                        {feature.properties.rating}
                      </button>
                    ))}
                  {soilStatus.data.features.every(
                    (feature) => (feature.properties.overlapPercent ?? 0) <= 0,
                  ) ? (
                    <span>No region overlap was calculated for this field.</span>
                  ) : null}
                </div>
              ) : null}
              {selectedSoilRegion ? (
                <div className="field-map-soil-details">
                  <b>
                    Region {selectedSoilRegion.polyId} · {selectedSoilRegion.rating}
                  </b>
                  <span>
                    Texture: {selectedSoilRegion.sand?.toFixed(1) ?? "Unavailable"}% sand, {" "}
                    {selectedSoilRegion.silt?.toFixed(1) ?? "Unavailable"}% silt, {" "}
                    {selectedSoilRegion.clay?.toFixed(1) ?? "Unavailable"}% clay
                  </span>
                  <span>
                    pH: {selectedSoilRegion.ph?.toFixed(1) ?? "Unavailable"} · Drainage:{" "}
                    {selectedSoilRegion.drainage ?? "Unavailable"}
                  </span>
                  <span>
                    Organic carbon: {selectedSoilRegion.organicCarbon?.toFixed(1) ?? "Unavailable"}% · Rooting depth: {" "}
                    {selectedSoilRegion.rootDepth ?? "Unavailable"}
                  </span>
                  <span>
                    Dominant soil: {selectedSoilRegion.dominantSoil ?? "Unavailable"} {" "}
                    {selectedSoilRegion.dominantPercent !== null
                      ? `(${selectedSoilRegion.dominantPercent}%)`
                      : ""}
                  </span>
                  <span>
                    Components: {selectedSoilRegion.components
                      .map(
                        (component) =>
                          `${component.soilName ?? component.soilId} ${component.percent}%`,
                      )
                      .join(", ")}
                  </span>
                  <span>
                    Limiting factors: {selectedSoilRegion.limitingFactors.join(" ")}
                  </span>
                </div>
              ) : (
                <small>Click a coloured region for soil details.</small>
              )}
            </>
          ) : null}
        </div>
      ) : null}
      </div>
    </section>
  );
}
