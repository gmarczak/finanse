import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/work-sans/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finanse",
  description: "Wydatki, limity, subskrypcje i cele — wiesz, na co idą pieniądze.",
  applicationName: "Finanse",
  appleWebApp: { capable: true, title: "Finanse", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#25272b" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
