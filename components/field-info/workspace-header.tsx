import Link from "next/link";
import type { FieldSpec } from "./data/types";

type WorkspaceHeaderProps = {
  field: FieldSpec | null;
};

export function WorkspaceHeader({ field }: WorkspaceHeaderProps) {
  return (
    <header className="field-workspace-header">
      <div className="field-workspace-brand">
        <Link className="field-workspace-brand-name" href="/">
          Farmish
        </Link>
        <span className="field-workspace-tagline">The dirt on your dirt.</span>
      </div>
      <div className="field-workspace-field">
        <div>
          <h1>{field?.name ?? "Loading field..."}</h1>
          <p>
            {field
              ? `${field.area.toFixed(2)} ${field.areaUnit}`
              : "Field details"}
            {field?.provenance.kind === "demo" ? (
              <span className="field-workspace-demo-badge">Demo</span>
            ) : null}
          </p>
        </div>
        <Link aria-label="Close field workspace" className="field-workspace-close" href="/">
          <span aria-hidden="true">×</span>
          Close
        </Link>
      </div>
    </header>
  );
}
