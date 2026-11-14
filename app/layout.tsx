import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farmish | The dirt on your dirt.",
  description: "The dirt on your dirt. Earth observation insights for resilient farming decisions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}