"use client";

import { EstimateBadge } from "@/components/ui/estimate-badge";
import type { DemoListing } from "./listings/demo-listings";
import { LAND_SCORE_NOTE, landScore } from "./listings/land-score";

type ListingCardProps = {
  listing: DemoListing;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: (listingId: string) => void;
  onHover: (listingId: string | null) => void;
};

const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ListingCard({
  listing,
  isSelected,
  isHighlighted,
  onSelect,
  onHover,
}: ListingCardProps) {
  const score = landScore(listing);

  return (
    <button
      aria-pressed={isSelected}
      className={`listing-card${isSelected ? " is-selected" : ""}${
        isHighlighted ? " is-highlighted" : ""
      }`}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(listing.id)}
      onFocus={() => onHover(listing.id)}
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      type="button"
    >
      <span className="listing-card-top">
        <span className="listing-card-name">{listing.name}</span>
        <EstimateBadge kind="demo" />
      </span>
      <span className="listing-card-price">{priceFormat.format(listing.priceUsd)}</span>
      <span className="listing-card-meta">
        <span>{listing.acres.toLocaleString("en-US")} ac</span>
        <span aria-hidden="true">·</span>
        <span>{priceFormat.format(Math.round(listing.priceUsd / listing.acres))}/ac</span>
        <span aria-hidden="true">·</span>
        <span className="listing-card-score">
          Score {score} <EstimateBadge title={LAND_SCORE_NOTE} />
        </span>
      </span>
      <span className="listing-card-description">{listing.description}</span>
    </button>
  );
}
