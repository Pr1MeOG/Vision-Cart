import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./index.css";

const safeTitle = (t: string) => t?.toString?.() ?? "";

type AuthMode = "login" | "register";

type Props = {
  onAuthenticated?: () => void;
};

export default function App(_props: Props) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  const title = useMemo(() => {
    return mode === "login" ? "Sign In" : "Create your account";
  }, [mode]);

  const oauthGoogle = () => {
    window.location.href = `${API.replace("/api", "")}/api/auth/google`;
  };

  const oauthDiscord = () => {
    window.location.href = `${API.replace("/api", "")}/api/auth/discord`;
  };

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}${mode === "login" ? "/auth/login" : "/auth/register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { name, email, password }
        ),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || "Something went wrong");
        return;
      }

      // OAuth flow sets cookies; token flow may return token
      if (data?.token) {
        localStorage.setItem("vc_token", data.token);
      }

      // Notify parent by redirecting (existing app uses cookie)
      // In this project, easiest is to reload so /auth/me picks up session.
      window.location.href = "/";
    } catch (e: any) {
      setError(safeTitle(e?.message) || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-orbs" aria-hidden />

      <motion.div
        className="auth-page-card"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <button className="auth-page-brand" onClick={() => (window.location.href = "/")}>
          <img src="/banner.gif" alt="VisionCart" />
          <div>
            <div className="auth-page-brand-name">VisionCart Store</div>
            <div className="auth-page-brand-sub">Sign in to continue</div>
          </div>
        </button>

        <div className="auth-page-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            Sign In
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            type="button"
          >
            Sign Up
          </button>
        </div>

        <h1 className="auth-page-title">{title}</h1>
        <p className="auth-page-subtitle">Fast checkout with Google or Discord OAuth.</p>

        <div className="auth-page-social">
          <button className="btn-google" type="button" onClick={oauthGoogle}>
            <span className="auth-page-social-label">Continue with Google</span>
          </button>
          <button className="btn-discord" type="button" onClick={oauthDiscord}>
            <span className="auth-page-social-label">Continue with Discord</span>
          </button>
        </div>

        <div className="auth-page-divider">Or</div>

        <div className="auth-page-form">
          {mode === "register" && (
            <label className="auth-page-field">
              <span>Full Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                autoComplete="name"
              />
            </label>
          )}

          <label className="auth-page-field">
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              type="email"
              autoComplete="email"
            />
          </label>

          <label className="auth-page-field">
            <span>Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </label>

          {error && <div className="auth-page-error">{error}</div>}

          <button
            className="btn-primary full auth-page-cta"
            type="button"
            onClick={submit}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <div className="auth-page-footer">
            {mode === "login" ? (
              <>
                New here?{" "}
                <button type="button" onClick={() => setMode("register")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence />
    </div>
  );
}

