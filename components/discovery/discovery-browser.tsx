"use client";

import { useMemo, useState } from "react";
import { EstimateBadge } from "@/components/ui/estimate-badge";
import { ListingCard } from "./listing-card";
import { ListingDetail } from "./listing-detail";
import { DEMO_LISTINGS_LABEL, demoListings } from "./listings/demo-listings";
import { DiscoveryMap } from "./discovery-map";
import type { MapMarker } from "./map-contract";

function shortPrice(priceCad: number): string {
  return priceCad >= 1_000_000
    ? `$${(priceCad / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
    : `$${Math.round(priceCad / 1000)}k`;
}

export function DiscoveryBrowser() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

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
        label: shortPrice(listing.priceCad),
      })),
    [],
  );

  return (
    <div className="discovery-browser">
      <div className="discovery-listings">
        <div className="discovery-listings-header">
          <p className="discovery-count">
            {demoListings.length} parcels <EstimateBadge kind="demo" title={DEMO_LISTINGS_LABEL} />
          </p>
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
        <DiscoveryMap
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
