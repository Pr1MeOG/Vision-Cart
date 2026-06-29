// AuthPage.jsx - Standalone Sign In / Sign Up Page
import React, { useState } from "react";
import { motion } from "framer-motion";
import { Chrome, Eye, EyeOff } from "lucide-react";
import "./index.css";

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
  </svg>
);

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

  const containerVariants = {
    hidden: {},
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  // OAuth handlers - maintaining existing Google and Discord OAuth
  const oauthGoogle = () => {
    window.location.href = `${API_URL}/api/auth/google`;
  };

  const oauthDiscord = () => {
    window.location.href = `${API_URL}/api/auth/discord`;
  };

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/${mode === "login" ? "login" : "register"}`, {
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

      if (data?.token) {
        localStorage.setItem("vc_token", data.token);
      }
      window.location.href = "/";
    } catch (e) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-main">
      {/* Left Column */}
      <section className="auth-left">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="auth-video"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4"
            type="video/mp4"
          />
        </video>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="auth-left-content"
        >
          <motion.div variants={itemVariants} className="auth-brand">
            <span className="auth-circle" />
            <span className="auth-brand-name">VisionCart</span>
          </motion.div>

          <motion.div variants={itemVariants} className="auth-steps-header">
            <h1>Join VisionCart</h1>
            <p>Fast checkout with Google or Discord OAuth.</p>
          </motion.div>

          <motion.div variants={itemVariants} className="auth-steps">
            <StepItem number="01" text="Register your identity" active={mode === "register"} />
            <StepItem number="02" text="Use social login" active={false} />
            <StepItem number="03" text="Start shopping" active={false} />
          </motion.div>
        </motion.div>
      </section>

      {/* Right Column */}
      <section className="auth-right">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="auth-form-wrapper"
        >
          {/* Header */}
          <div className="auth-form-header">
            <h2>{mode === "login" ? "Sign In" : "Create New Profile"}</h2>
            <p>{mode === "login" ? "Welcome back! Please enter your details." : "Input your basic details to begin the journey."}</p>
          </div>

          {/* Social Buttons - Updated for Google & Discord */}
          <div className="auth-social-grid">
            <SocialButton icon={<Chrome size={18} />} label="Google" onClick={oauthGoogle} />
            <SocialButton icon={<DiscordIcon />} label="Discord" onClick={oauthDiscord} />
          </div>

          {/* Divider */}
          <div className="auth-divider-row">
            <span>Or</span>
          </div>

          {/* Form */}
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {mode === "register" && (
              <div className="auth-input-row">
                <InputGroup
                  label="Full Name"
                  placeholder="John Doe"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            <div className={mode === "register" ? "auth-input-row" : ""}>
              <InputGroup
                label={mode === "login" ? "Email" : "Email Address"}
                placeholder="john@example.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <PasswordInput
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              onSubmit={submit}
              showHint={true}
            />

            {error && <div className="auth-error">{error}</div>}

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : (mode === "login" ? "Sign In" : "Create Account")}
            </button>
          </form>

          {/* Footer */}
          <div className="auth-switch-mode">
            {mode === "login" ? (
              <>New here? <button type="button" onClick={() => setMode("register")}>Create an account</button></>
            ) : (
              <>Already have an account? <button type="button" onClick={() => setMode("login")}>Sign in</button></>
            )}
          </div>
        </motion.div>
      </section>
    </main>
  );
}

function StepItem({ number, text, active = false }) {
  return (
    <div className={`step-item ${active ? "step-active" : ""}`}>
      <div className={`step-number ${active ? "step-number-active" : ""}`}>{number}</div>
      <span className="step-text">{text}</span>
    </div>
  );
}

function SocialButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      className="social-btn"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function InputGroup({ label, placeholder, type, value, onChange }) {
  return (
    <div className="input-group">
      <label>{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="auth-input"
      />
    </div>
  );
}

function PasswordInput({ label, placeholder, value, onChange, showPassword, setShowPassword, onSubmit, showHint }) {
  return (
    <div className="password-group">
      <label>{label}</label>
      <div className="password-wrapper">
        <input
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="auth-input"
          onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="password-toggle"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {showHint && <p className="password-hint">Requires at least 8 characters.</p>}
    </div>
  );
}