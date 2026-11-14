import { SiteShell } from "@/components/layout/site-shell";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export default function FutureFarmPage() {
  return (
    <SiteShell>
      <p className="eyebrow">Plan for resilience</p>
      <h1>Future Farm</h1>
      <p className="intro">Explore how heat, water availability, and extreme rainfall may affect farm resilience over time.</p>
      <SectionPlaceholder title="Long-term outlook" description="Current, 10-year, and 20-year farm scores and recommended adaptations will be added here." />
    </SiteShell>
  );
}