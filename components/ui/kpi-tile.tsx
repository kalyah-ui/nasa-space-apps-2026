import { EstimateBadge } from "@/components/ui/estimate-badge";

export type KpiTileProps = {
  label: string;
  value: string | null;
  unit?: string;
  note?: string;
  loading?: boolean;
  estimateTitle?: string;
};

/** One labelled stat tile with loading-skeleton and missing-value states. */
export function KpiTile({ label, value, unit, note, loading, estimateTitle }: KpiTileProps) {
  return (
    <div className="kpi-tile">
      <span className="kpi-tile-label">
        {label}
        {estimateTitle ? <EstimateBadge title={estimateTitle} /> : null}
      </span>
      {loading ? (
        <span aria-hidden="true" className="skeleton kpi-tile-skeleton" />
      ) : (
        <span className="kpi-tile-value">
          {value ?? "—"}
          {value !== null && unit ? <span className="kpi-tile-unit"> {unit}</span> : null}
        </span>
      )}
      {note ? <span className="kpi-tile-note">{note}</span> : null}
    </div>
  );
}
