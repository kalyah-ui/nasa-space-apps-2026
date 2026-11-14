import type { Metadata } from "next";
import "./globals.css";
import "../styles/glass.css";

export const metadata: Metadata = {
  title: "Farmish | The dirt on your dirt.",
  description: "The dirt on your dirt. Earth observation insights for resilient farming decisions.",
};

/**
 * Runs before first paint so the page never flashes the wrong theme:
 * stored choice wins, otherwise the system preference, otherwise dark.
 */
const themeInitScript = `(function () {
  var theme = "dark";
  try {
    var stored = localStorage.getItem("farmish-theme");
    if (stored === "light" || stored === "dark") {
      theme = stored;
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      theme = "light";
    }
  } catch (error) {}
  document.documentElement.dataset.theme = theme;
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}