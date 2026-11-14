type EstimateBadgeProps = {
  kind?: "demo" | "estimate";
  /** Optional explanation shown as a native tooltip. */
  title?: string;
};

/** Small solid badge marking a value as demo data or a frontend estimate. */
export function EstimateBadge({ kind = "estimate", title }: EstimateBadgeProps) {
  return (
    <span className={`badge badge--${kind}`} title={title}>
      {kind === "demo" ? "Demo" : "Estimate"}
    </span>
  );
}
