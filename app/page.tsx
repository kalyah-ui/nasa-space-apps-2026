import Image from "next/image";
import Link from "next/link";
import loamLogo from "@/assets/images/loam-logo.png";
import { FieldSnapshot } from "@/components/landing/field-snapshot";
import { SiteShell } from "@/components/layout/site-shell";

const workflows = [
  { href: "/discovery", title: "Farm Discovery", description: "Assess land potential, environmental risks, and crop fit." },
  { href: "/field-info", title: "Field Info", description: "Review recent moisture, rainfall, vegetation, and terrain." },
  { href: "/rotation-planner", title: "Rotation Planner", description: "Compare strategies for water use, soil health, and resilience." },
];

export default function HomePage() {
  return (
    <SiteShell>
      <section aria-labelledby="landing-hero-title" className="landing-hero">
        <div className="landing-hero-content">
          <p className="eyebrow">Land intelligence for a changing climate</p>
          <h1 className="landing-hero-name" id="landing-hero-title">
            Loam
          </h1>
          <p className="landing-hero-tagline">The Dirt on Your Dirt.</p>
          <p className="landing-hero-description">
            NASA Earth observation and agricultural data put simply. <br />
            Improving your land now and in years to come.
          </p>
          <div className="landing-cta-row">
            <Link className="landing-cta is-primary" href="/discovery">
              Browse parcels
            </Link>
            <Link className="landing-cta" href="/field-info">
              Open Field Info
            </Link>
          </div>
        </div>
        <Image
          alt="Loam logo: a basket of fresh produce and grain"
          className="landing-hero-logo"
          src={loamLogo}
          sizes="(max-width: 900px) 80vw, 40vw"
          priority
        />
      </section>

      <div aria-label="Loam Workflows" className="workflow-grid">
        {workflows.map((workflow) => (
          <Link className="workflow-card" href={workflow.href} key={workflow.href}>
            <h2 className="workflow-title">{workflow.title}</h2>
            <p className="workflow-description">{workflow.description}</p>
            <span aria-hidden="true" className="workflow-arrow">→</span>
          </Link>
        ))}
      </div>

      <FieldSnapshot />
    </SiteShell>
  );
}
