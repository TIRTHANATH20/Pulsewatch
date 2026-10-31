import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppHeader from "@/app/components/AppHeader";
import HeroBackground from "@/app/components/HeroBackground";
import PulseWatchIntro from "@/app/components/PulseWatchIntro";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulseWatch",
  description:
    "PulseWatch — a smart market watchlist that surfaces what meaningfully changed since you last checked.",
};

// Applies the saved theme (light/dark) to <html> before React hydrates
// and before first paint, so switching themes never causes a visible
// flash of the wrong colors on reload. Kept tiny and inline —
// deliberately not an extra script file/network request.
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("pw-theme");
    document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body>
        <HeroBackground />
        <PulseWatchIntro>
          <AppHeader />
          {children}
        </PulseWatchIntro>
      </body>
    </html>
  );
}
