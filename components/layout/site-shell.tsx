import { AppNav } from "@/components/layout/app-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div>
            <p className="brand">Farmish</p>
            <p className="brand-note">The dirt on your dirt.</p>
          </div>
          <ThemeToggle />
        </div>
        <AppNav />
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
