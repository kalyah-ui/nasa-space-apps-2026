import { SiteShell } from "@/components/layout/site-shell";
import { RotationPlanner } from "./rotation-planner";

export default function RotationPlannerPage() {
  return (
    <SiteShell>
      <p className="eyebrow">Compare strategies</p>
      <h1>Rotation Planner</h1>
      <p className="intro">
        Review current field conditions and compare rotation strategies for soil health, water use, resilience, and market potential.
      </p>
      <RotationPlanner />
    </SiteShell>
  );
}