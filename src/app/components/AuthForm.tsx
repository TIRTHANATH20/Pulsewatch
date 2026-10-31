"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import * as api from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";

interface AuthFormProps {
  mode: "login" | "signup";
}

// Shared by /login and /signup — same fields, same validation/loading/
// error/success states, different copy and API call.
export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter a password.");
      return;
    }
    if (isSignup && password.length < 4) {
      setError("Use a password with at least 4 characters.");
      return;
    }

    setStatus("loading");
    try {
      if (isSignup) {
        await api.signup(trimmedEmail, password);
      } else {
        await api.login(trimmedEmail, password);
      }
      setStatus("success");
      router.push("/");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Try again.",
      );
    }
  }

  return (
    <div className="auth-shell">
      {/* Ambient waves + purple glow are rendered site-wide by
          HeroBackground (see layout.tsx) in its "is-auth" mode — no
          second wave layer here, to keep the background from competing
          with the form. */}
      <motion.div
        className="auth-card liquid-glass"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link href="/" className="app-brand auth-brand">
          <span className="app-brand-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="M3 12h4l2.5 7L14 5l2 7h5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="app-brand-name">PulseWatch</span>
        </Link>

        <div
          className="auth-toggle"
          role="tablist"
          aria-label="Login or sign up"
        >
          <Link
            href="/login"
            role="tab"
            aria-selected={!isSignup}
            className={`auth-toggle-tab ${!isSignup ? "is-active" : ""}`}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            role="tab"
            aria-selected={isSignup}
            className={`auth-toggle-tab ${isSignup ? "is-active" : ""}`}
          >
            Sign up
          </Link>
        </div>

        <p className="auth-kicker">PulseWatch</p>
        <h1 className="auth-title">
          {isSignup
            ? "Create your watchlist intelligence."
            : "See what changed."}
        </h1>
        <p className="auth-subtitle">
          {isSignup
            ? "Start with a market view that remembers what moved."
            : "PulseWatch watches your market for you — so you don’t have to."}
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={status === "loading" || status === "success"}
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isSignup ? "At least 4 characters" : "Your password"
              }
              minLength={isSignup ? 4 : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              disabled={status === "loading" || status === "success"}
            />
          </label>

          {error && (
            <motion.p
              className="auth-error"
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {error}
            </motion.p>
          )}

          {status === "success" && (
            <p className="auth-success" role="status">
              {isSignup
                ? "Account created — redirecting…"
                : "Signed in — redirecting…"}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={status === "loading" || status === "success"}
          >
            {status === "loading"
              ? isSignup
                ? "Creating account…"
                : "Signing in…"
              : isSignup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/signup">Create an account</Link>
            </>
          )}
        </p>
      </motion.div>
    </div>
  );
}
