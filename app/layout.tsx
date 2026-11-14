import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FarmScope AI",
  description: "Earth observation insights for resilient farming decisions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}