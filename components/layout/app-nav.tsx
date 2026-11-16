"use client";

import { Compass, House, MapPin, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const navigation = [
  { href: "/", label: "Overview", Icon: House },
  { href: "/discovery", label: "Discovery", Icon: Compass },
  { href: "/field-info", label: "Field Info", Icon: MapPin },
  { href: "/rotation-planner", label: "Rotation Planner", Icon: RefreshCw },
];

type PillRect = { top: number; left: number; width: number; height: number };

type AppNavProps = {
  /** "sidebar" = vertical with labels; "compact" = horizontal icon row for the workspace header. */
  variant?: "sidebar" | "compact";
};

/**
 * Persistent main navigation. A glass pill sits under the active tab and
 * slides to the hovered/focused tab, returning to the active one on leave.
 */
export function AppNav({ variant = "sidebar" }: AppNavProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<PillRect | null>(null);

  const movePillTo = useCallback((target: HTMLElement | null) => {
    if (!target) {
      setPill(null);
      return;
    }
    setPill({
      top: target.offsetTop,
      left: target.offsetLeft,
      width: target.offsetWidth,
      height: target.offsetHeight,
    });
  }, []);

  const movePillToActive = useCallback(() => {
    movePillTo(navRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? null);
  }, [movePillTo]);

  useEffect(() => {
    movePillToActive();

    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const observer = new ResizeObserver(() => movePillToActive());
    observer.observe(nav);
    return () => observer.disconnect();
  }, [movePillToActive, pathname]);

  return (
    <nav
      aria-label="Main navigation"
      className={`app-nav app-nav--${variant}`}
      onBlur={(event) => {
        if (!navRef.current?.contains(event.relatedTarget as Node | null)) {
          movePillToActive();
        }
      }}
      onMouseLeave={movePillToActive}
      ref={navRef}
    >
      {pill ? (
        <span
          aria-hidden="true"
          className="app-nav-pill"
          style={{
            height: pill.height,
            transform: `translate(${pill.left}px, ${pill.top}px)`,
            width: pill.width,
          }}
        />
      ) : null}
      {navigation.map(({ href, Icon, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`app-nav-link${isActive ? " is-active" : ""}`}
            href={href}
            key={href}
            onFocus={(event) => movePillTo(event.currentTarget)}
            onMouseEnter={(event) => movePillTo(event.currentTarget)}
            title={label}
          >
            <Icon aria-hidden="true" className="app-nav-icon" size={16} strokeWidth={1.8} />
            <span className="app-nav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
