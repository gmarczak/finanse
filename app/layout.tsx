import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/work-sans/index.css";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

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
  themeColor: "#f5f0e8", // przy ciemnym motywie podmienia go THEME_SCRIPT
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
