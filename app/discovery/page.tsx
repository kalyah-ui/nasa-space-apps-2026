import { SiteShell } from "@/components/layout/site-shell";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export default function DiscoveryPage() {
  return (
    <SiteShell currentPath="/discovery">
      <p className="eyebrow">Explore a parcel</p>
      <h1>Farm Discovery</h1>
      <p className="intro">Evaluate soil, water availability, terrain, and climate risks for a potential farm site.</p>
      <SectionPlaceholder title="Parcel analysis" description="Parcel search, map layers, farm scoring, and crop recommendations will be added here." />
    </SiteShell>
  );
}