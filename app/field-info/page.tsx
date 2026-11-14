import { SiteShell } from "@/components/layout/site-shell";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export default function FieldInfoPage() {
  return (
    <SiteShell currentPath="/field-info">
      <p className="eyebrow">Current conditions</p>
      <h1>Field Info</h1>
      <p className="intro">Bring recent and historical environmental conditions together for a field.</p>
      <SectionPlaceholder title="Field conditions" description="Soil moisture, rainfall, vegetation, terrain, and trend visualizations will be added here." />
    </SiteShell>
  );
}