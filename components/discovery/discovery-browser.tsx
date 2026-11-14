"use client";

import { useMemo, useState } from "react";
import { EstimateBadge } from "@/components/ui/estimate-badge";
import { ListingCard } from "./listing-card";
import { ListingDetail } from "./listing-detail";
import { DEMO_LISTINGS_LABEL, demoListings } from "./listings/demo-listings";
import { landScore } from "./listings/land-score";
import type { MapMarker } from "./map-contract";
import { MapSlot } from "./map-slot";

type MarkerMode = "price" | "score";

function shortPrice(priceUsd: number): string {
  return priceUsd >= 1_000_000
    ? `$${(priceUsd / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
    : `$${Math.round(priceUsd / 1000)}k`;
}

export function DiscoveryBrowser() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [markerMode, setMarkerMode] = useState<MarkerMode>("price");

  const toggleSelected = (listingId: string) => {
    setSelectedId((current) => (current === listingId ? null : listingId));
  };

  const selectedListing = demoListings.find((listing) => listing.id === selectedId) ?? null;

  const markers = useMemo<MapMarker[]>(
    () =>
      demoListings.map((listing) => ({
        id: listing.id,
        latitude: listing.latitude,
        longitude: listing.longitude,
        label: markerMode === "price" ? shortPrice(listing.priceUsd) : `${landScore(listing)}`,
      })),
    [markerMode],
  );

  return (
    <div className="discovery-browser">
      <div className="discovery-listings">
        <div className="discovery-listings-header">
          <p className="discovery-count">
            {demoListings.length} parcels <EstimateBadge kind="demo" title={DEMO_LISTINGS_LABEL} />
          </p>
          <div aria-label="Marker labels" className="marker-mode-toggle" role="group">
            <button
              aria-pressed={markerMode === "price"}
              className={markerMode === "price" ? "is-active" : undefined}
              onClick={() => setMarkerMode("price")}
              type="button"
            >
              Price
            </button>
            <button
              aria-pressed={markerMode === "score"}
              className={markerMode === "score" ? "is-active" : undefined}
              onClick={() => setMarkerMode("score")}
              type="button"
            >
              Score
            </button>
          </div>
        </div>

        {demoListings.map((listing) => (
          <ListingCard
            isHighlighted={highlightedId === listing.id}
            isSelected={selectedId === listing.id}
            key={listing.id}
            listing={listing}
            onHover={setHighlightedId}
            onSelect={toggleSelected}
          />
        ))}
      </div>

      <div className="discovery-map-area">
        <MapSlot
          highlightedMarkerId={highlightedId}
          markers={markers}
          onHoverMarker={setHighlightedId}
          onSelectMarker={toggleSelected}
          selectedMarkerId={selectedId}
        />
        {selectedListing ? (
          <ListingDetail
            listing={selectedListing}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
