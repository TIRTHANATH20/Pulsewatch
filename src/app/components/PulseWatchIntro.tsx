"use client";

import { useEffect, useState, type ReactNode } from "react";

const WORD = "PulseWatch...";

// Timing tuned to land the whole sequence around ~1.7-1.8s — a touch
// longer than the spec's original "1-1.5s" floor, at the user's request,
// while staying well short of the "not 4-5s" ceiling. Kept as a plain
// setTimeout chain rather than a state machine library — five
// sequential timers is simple enough to read directly.
const CHAR_DELAY_MS = 58; // ~50-90ms/char per spec
const HOLD_MS = 200; // hold the completed word briefly
const BLINK_MS = 460; // let the cursor blink a couple of times
const FADE_MS = 350; // fade the intro out

type Phase = "typing" | "holding" | "fading" | "done";

// Full-screen black splash shown once per real page load (this
// component only mounts once per hard navigation — Next's app router
// keeps the root layout mounted across client-side navigation, so this
// never replays on re-renders or route changes within a session).
// Wraps the app content it's given so the reveal (opacity/translateY)
// can be driven from the same timer sequence — see globals.css
// `.pw-app-shell`. Deliberately does not wrap `<HeroBackground />`
// (rendered as a sibling in layout.tsx): that component uses
// `position: fixed`, and animating a `transform` on an ancestor would
// change its containing block and break its full-viewport coverage.
export default function PulseWatchIntro({ children }: { children: ReactNode }) {
  const [charCount, setCharCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");

  // Plain mount effect — no "have we already run" ref guard. In dev,
  // React 18 Strict Mode intentionally mounts, cleans up, and
  // re-mounts once; a guard here would let the first (discarded) batch
  // of timers get cleared without the second, real mount ever
  // scheduling replacements, leaving the reveal stuck at 0 characters.
  // Letting cleanup + re-run happen normally (as for any correctly
  // written effect) converges to the same result in prod, where
  // there's no double-invoke.
  useEffect(() => {
    setCharCount(0);
    setPhase("typing");

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (reducedMotion) {
      // Skip the letter-by-letter reveal entirely — show the finished
      // word, then fade out quickly.
      setCharCount(WORD.length);
      timers.push(setTimeout(() => setPhase("fading"), 160));
      timers.push(setTimeout(() => setPhase("done"), 160 + 260));
    } else {
      for (let i = 1; i <= WORD.length; i++) {
        timers.push(setTimeout(() => setCharCount(i), i * CHAR_DELAY_MS));
      }
      const typedAt = WORD.length * CHAR_DELAY_MS;
      timers.push(setTimeout(() => setPhase("holding"), typedAt + HOLD_MS));
      timers.push(setTimeout(() => setPhase("fading"), typedAt + HOLD_MS + BLINK_MS));
      timers.push(setTimeout(() => setPhase("done"), typedAt + HOLD_MS + BLINK_MS + FADE_MS));
    }

    return () => timers.forEach(clearTimeout);
  }, []);

  const revealed = phase === "fading" || phase === "done";

  return (
    <>
      {phase !== "done" && (
        <div className={`pw-intro${phase === "fading" ? " is-fading" : ""}`} aria-hidden="true">
          <span className="pw-intro-word">
            {WORD.slice(0, charCount)}
            <span className="pw-intro-cursor" />
          </span>
        </div>
      )}
      {/* No-JS fallback: without JS the timers above never run, so the
          shell must default to visible rather than staying at opacity:0
          forever. */}
      <noscript>
        <style>{`.pw-intro{display:none} .pw-app-shell{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <div className={`pw-app-shell${revealed ? " is-revealed" : ""}`}>{children}</div>
    </>
  );
}
