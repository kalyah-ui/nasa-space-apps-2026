import { DiscoveryBrowser } from "@/components/discovery/discovery-browser";
import { SiteShell } from "@/components/layout/site-shell";

export default function DiscoveryPage() {
  return (
    <SiteShell>
      <p className="eyebrow">Browse parcels</p>
      <h1>Farm Discovery</h1>
      <p className="intro">
        Browse demo farmland listings and size up the dirt before you dig deeper. Every parcel here
        is fictional demo data.
      </p>
      <DiscoveryBrowser />
    </SiteShell>
  );
}