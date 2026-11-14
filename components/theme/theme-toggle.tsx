"use client";

const STORAGE_KEY = "farmish-theme";

/**
 * Sun/moon theme switch. Both icons are always rendered; CSS shows the one
 * matching the current `data-theme` on <html>, so no client state is needed
 * and server/client markup always match.
 */
export function ThemeToggle() {
  const toggleTheme = () => {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = nextTheme;
    try {
      localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this page.
    }
  };

  return (
    <button
      aria-label="Toggle light or dark theme"
      className="theme-toggle"
      onClick={toggleTheme}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="theme-toggle-sun"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        width="16"
      >
        <circle cx="12" cy="12" r="4.4" />
        <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
      </svg>
      <svg
        aria-hidden="true"
        className="theme-toggle-moon"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        width="16"
      >
        <path d="M20.2 14.1A8.2 8.2 0 0 1 9.9 3.8a8.2 8.2 0 1 0 10.3 10.3Z" />
      </svg>
    </button>
  );
}
