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
    <SiteShell currentPath="/">
      <p className="eyebrow">Land intelligence for a changing climate</p>
      <h1>Make the next farm decision with more context.</h1>
      <p className="intro">
        Explore environmental signals and agricultural data to understand what a parcel can support today and over time.
      </p>
      <div aria-label="FarmScope workflows" className="workflow-list">
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