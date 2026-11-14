import Link from "next/link";

const navigation = [
  { href: "/", label: "Overview" },
  { href: "/discovery", label: "Farm Discovery" },
  { href: "/field-info", label: "Field Info" },
  { href: "/rotation-planner", label: "Rotation Planner" },
  { href: "/future-farm", label: "Future Farm" },
];

export function SiteShell({ children, currentPath }: { children: React.ReactNode; currentPath: string }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="brand">FarmScope AI</p>
          <p className="brand-note">From buying land to building a resilient farm</p>
        </div>
        <nav aria-label="Main navigation" className="navigation">
          {navigation.map((item) => (
            <Link
              aria-current={currentPath === item.href ? "page" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}