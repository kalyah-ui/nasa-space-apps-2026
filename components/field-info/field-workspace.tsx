"use client";

import Link from "next/link";

export function FieldWorkspace() {
  return (
    <main className="field-workspace">
      <header className="field-workspace-header">
        <div className="field-workspace-brand">
          <Link className="field-workspace-brand-name" href="/">
            Farmish
          </Link>
          <span className="field-workspace-tagline">The dirt on your dirt.</span>
        </div>
        <div className="field-workspace-field">
          <div>
            <h1>Test Field #1</h1>
            <p>34.90 ha</p>
          </div>
          <Link aria-label="Close field workspace" className="field-workspace-close" href="/">
            <span aria-hidden="true">×</span>
            Close
          </Link>
        </div>
      </header>

      <div className="field-workspace-body">
        <aside aria-label="Field workspace layers" className="field-workspace-sidebar">
          <p className="field-workspace-overline">Field layers</p>
          <h2>Explore this field</h2>
          <p className="field-workspace-description">
            Layer controls and field insights will be added in the next step.
          </p>
        </aside>

        <section aria-label="Field map" className="field-workspace-map">
          <div className="field-workspace-map-placeholder">
            <span aria-hidden="true" className="field-workspace-map-mark">F</span>
            <p className="field-workspace-overline">Map workspace</p>
            <h2>Field map coming next</h2>
            <p>
              The map canvas is ready for the basemap, field boundary, and data overlays.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
