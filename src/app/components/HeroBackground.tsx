"use client";

import { useMemo } from "react";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

// Fixed, decorative backdrop rendered once by the root layout behind
// every page (dashboard, /login, /signup). Deliberately just a handful
// of slow-moving SVG paths and soft glows — no chart data, no
// per-instrument meaning — this is ambience,
// not information. `pointer-events: none` and a negative z-index keep it
// completely inert; `prefers-reduced-motion` freezes every animation in
// place instead of removing the visual, so the page doesn't jump.
//
// No Three.js / heavy engine: a handful of flowing <path> lines and
// radial glow orbs. Orbs (plain divs) animate via Framer Motion
// transforms; wave <path>s animate via native SVG SMIL
// (<animate>/<animateTransform>) since Framer Motion doesn't reliably
// drive transform on bare SVG path elements — either way, the browser
// compositor handles it cheaply regardless of how many cards are on
// screen above it.
// Ambient waves shown site-wide, kept very subtle so they never compete
// with dashboard content. Alternates the green/purple accents so the
// purple accent (spec section 2: "secondary visual accent, especially
// gradients/visualizations") shows up here too, not just on auth pages.
const AMBIENT_WAVES = [
  { d: "M-100,180 C-25,120 50,120 125,180 S275,240 350,180 S500,120 575,180 S725,240 800,180 S950,120 1025,180 S1175,240 1250,180 S1400,120 1500,180", duration: 10, opacity: 0.22, color: "var(--color-accent)" },
];

// Auth pages get a more deliberate, layered flow of green + purple waves
// (spec section 3) — still "subtle/professional", not neon, but clearly
// more alive than the ambient dashboard backdrop since the login card
// has nothing else competing for attention.
// Kept low-opacity (spec: ~0.08-0.18) so these read as ambient market
// movement behind the auth card rather than a decorative graphic
// competing with the form for attention. Animated the same way as the
// dashboard's ambient wave below — plain SVG `<animateTransform>`
// (SMIL), not a Framer Motion transform — because Framer Motion's `y`
// motion value doesn't reliably animate a bare `<path>` (it isn't one
// of the SVG tags Framer maps transform props onto), which is why this
// layer previously rendered but never actually moved.
const AUTH_WAVES = [
  { d: "M-100,120 C 220,60 420,180 720,100 S 1240,40 1520,140", dur: "9s", begin: "0s", values: "0 0; 0 -22; 0 0; 0 20; 0 0", opacity: 0.18, color: "var(--color-accent)" },
  { d: "M-100,260 C 260,340 460,180 760,280 S 1260,360 1520,260", dur: "11s", begin: "-2.5s", values: "0 0; 0 18; 0 0; 0 -26; 0 0", opacity: 0.24, color: "#d9ccff" },
  { d: "M-100,420 C 220,360 480,480 760,400 S 1260,340 1520,440", dur: "14s", begin: "-5s", values: "0 0; 0 -16; 0 0; 0 28; 0 0", opacity: 0.13, color: "var(--color-accent)" },
  { d: "M-100,560 C 260,620 480,500 780,580 S 1280,640 1520,560", dur: "17s", begin: "-7.5s", values: "0 0; 0 24; 0 0; 0 -16; 0 0", opacity: 0.2, color: "#d9ccff" },
];

// The auth purple orb slowly traces a full loop around the screen's
// boundary — top-right corner → top-left → bottom-left → bottom-right
// → back — using absolute top/left percentage keyframes (not a small
// offset from a fixed anchor), so it visibly travels across the whole
// screen rather than staying confined to one side. `.hero-background`
// clips overflow, so the loop can safely swing slightly past the
// viewport edge.
const AUTH_ORB_LOOP = {
  top: ["2%", "-8%", "62%", "68%", "2%"],
  left: ["76%", "6%", "10%", "72%", "76%"],
};

export default function HeroBackground() {
  const prefersReducedMotion = useReducedMotion();
  const pathname = usePathname();
  const isAuthRoute = pathname === "/login" || pathname === "/signup";

  const waves = isAuthRoute ? AUTH_WAVES : AMBIENT_WAVES;

  const orbs = useMemo(
    () =>
      isAuthRoute
        ? [
            { top: "-10%", left: "8%", size: 480, delay: 0, color: "var(--color-accent)" },
            { top: "4%", left: "72%", size: 380, delay: 1.2, color: "var(--color-purple)", loop: true },
            { top: "58%", left: "-6%", size: 360, delay: 2.1, color: "var(--color-purple)" },
          ]
        : [
            { top: "-8%", left: "12%", size: 420, delay: 0, color: "var(--color-accent)" },
            { top: "8%", left: "78%", size: 320, delay: 1.4, color: "var(--color-purple)" },
          ],
    [isAuthRoute],
  );

  return (
    <div className={`hero-background ${isAuthRoute ? "is-auth" : ""}`} aria-hidden="true">
      {orbs.map((orb, i) => {
        const loops = "loop" in orb && orb.loop && !prefersReducedMotion;
        return (
          <motion.div
            key={i}
            className="hero-orb"
            style={{
              // A looping orb's position is driven entirely by `animate`
              // below (top/left keyframes); the static ones still use
              // this anchor.
              top: loops ? undefined : orb.top,
              left: loops ? undefined : orb.left,
              width: orb.size,
              height: orb.size,
              background: `radial-gradient(circle, ${
                orb.color === "var(--color-purple)"
                  ? isAuthRoute ? "rgba(139, 92, 246, 0.52)" : "rgba(139, 92, 246, 0.22)"
                  : isAuthRoute ? "rgba(0, 200, 83, 0.26)" : "rgba(0, 200, 83, 0.22)"
              }, transparent 70%)`,
            }}
            initial={loops ? { top: AUTH_ORB_LOOP.top[0], left: AUTH_ORB_LOOP.left[0] } : undefined}
            animate={
              prefersReducedMotion
                ? { opacity: 0.55, top: orb.top, left: orb.left }
                : loops
                  ? { opacity: [0.35, 0.6, 0.35], scale: [1, 1.08, 1], top: AUTH_ORB_LOOP.top, left: AUTH_ORB_LOOP.left }
                  : { opacity: [0.35, 0.6, 0.35], scale: [1, 1.08, 1] }
            }
            transition={
              loops
                ? { duration: 26, repeat: Infinity, ease: "easeInOut", delay: orb.delay }
                : { duration: 10 + i * 3, repeat: Infinity, ease: "easeInOut", delay: orb.delay }
            }
          />
        );
      })}

      <svg
        className="hero-wave-svg"
        viewBox="0 0 1400 620"
        preserveAspectRatio="none"
        role="presentation"
      >
        {waves.map((wave, i) =>
          isAuthRoute ? (
            <path key={i} d={wave.d} fill="none" stroke={wave.color} strokeWidth="1.8" style={{ opacity: wave.opacity }}>
              {!prefersReducedMotion && (
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values={"values" in wave ? wave.values : "0 0"}
                  dur={"dur" in wave ? wave.dur : "10s"}
                  begin={"begin" in wave ? wave.begin : "0s"}
                  repeatCount="indefinite"
                />
              )}
            </path>
          ) : (
            <Fragment key={i}>
              <path className="dashboard-wave-path" d={wave.d} fill="none" stroke={wave.color} strokeWidth="2.2" style={{ opacity: wave.opacity }}>
                {!prefersReducedMotion && <animate attributeName="d" dur="6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1" values={[
                  "M-100,180 C-25,155 50,155 125,180 S275,205 350,180 S500,155 575,180 S725,205 800,180 S950,155 1025,180 S1175,205 1250,180 S1400,155 1500,180",
                  "M-100,180 C-25,166 50,166 125,180 S275,194 350,180 S500,166 575,180 S725,194 800,180 S950,166 1025,180 S1175,194 1250,180 S1400,166 1500,180",
                  "M-100,180 C-25,155 50,155 125,180 S275,205 350,180 S500,155 575,180 S725,205 800,180 S950,155 1025,180 S1175,205 1250,180 S1400,155 1500,180"
                ].join(";")} />}
              </path>
            </Fragment>
          ),
        )}
      </svg>

      <div className="hero-grid-fade" />
    </div>
  );
}
