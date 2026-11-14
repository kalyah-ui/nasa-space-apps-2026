import { SiteShell } from "@/components/layout/site-shell";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export default function RotationPlannerPage() {
  return (
    <SiteShell>
      <p className="eyebrow">Compare strategies</p>
      <h1>Rotation Planner</h1>
      <p className="intro">Compare crop rotation options across water use, soil impact, resilience, and market viability.</p>
      <SectionPlaceholder title="Rotation scenarios" description="Current, profit-focused, water-conservation, and soil-regeneration scenarios will be added here." />
    </SiteShell>
  );
}