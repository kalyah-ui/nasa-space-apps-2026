import Link from "next/link";
import { SiteShell } from "@/components/layout/site-shell";

const workflows = [
  { href: "/discovery", title: "Farm Discovery", description: "Assess land potential, environmental risks, and crop fit." },
  { href: "/field-info", title: "Field Info", description: "Review recent moisture, rainfall, vegetation, and terrain." },
  { href: "/rotation-planner", title: "Rotation Planner", description: "Compare strategies for water use, soil health, and resilience." },
  { href: "/future-farm", title: "Future Farm", description: "Explore how long-term climate pressures may shape farm resilience." },
];

export default function HomePage() {
  return (
    <SiteShell>
      <section aria-labelledby="landing-hero-title" className="landing-hero">
        <p className="eyebrow">Land intelligence for a changing climate</p>
        <h1 className="landing-hero-name" id="landing-hero-title">
          loam
        </h1>
        <p className="landing-hero-tagline">The dirt on your dirt.</p>
        <p className="landing-hero-description">
          NASA Earth observation and open agricultural data, read together — so you can judge what
          a parcel supports today, and whether it still will in ten years.
        </p>
        <div className="landing-cta-row">
          <Link className="landing-cta is-primary" href="/discovery">
            Browse parcels
          </Link>
          <Link className="landing-cta" href="/field-info">
            Open Field Info
          </Link>
        </div>
      </section>

      <div aria-label="loam workflows" className="workflow-list">
        {workflows.map((workflow) => (
          <Link className="workflow-link" href={workflow.href} key={workflow.href}>
            <div>
              <h2 className="workflow-title">{workflow.title}</h2>
              <p className="workflow-description">{workflow.description}</p>
            </div>
            <span aria-hidden="true" className="workflow-arrow">→</span>
          </Link>
        ))}
      </div>
    </SiteShell>
  );
}
