import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { staffLogin } from "@/lib/api";
import { isAuthenticated, setSessionTokens } from "@/lib/auth";

const staffPoints = [
  "Platform-wide company control",
  "Staff-only restricted access",
  "Audit activity & workspace handoff",
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (isAuthenticated()) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const code = passcode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setError("Enter the 6-digit staff passcode");
      setBusy(false);
      return;
    }
    try {
      const session = await staffLogin(email.trim(), password, code);
      setSessionTokens(session.access_token, session.refresh_token);
      void navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="staff-login">
      <aside className="staff-login-brand" aria-hidden={false}>
        <div className="staff-login-atmosphere" aria-hidden />
        <div className="staff-login-brand-inner">
          <div className="staff-login-logo">
            <span className="staff-login-logo-mark" aria-hidden>
              TG
            </span>
            <span>TrueGage</span>
          </div>
          <div className="staff-login-hero">
            <p className="staff-login-kicker">Restricted · Internal</p>
            <h1>TrueGage Staff Access</h1>
            <p>
              This console is for TrueGage platform staff only. Customer workspace users are denied
              access — use the main app to sign in to your company.
            </p>
            <ul>
              {staffPoints.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        </div>
        <svg
          aria-hidden
          className="staff-login-wave"
          viewBox="0 0 96 900"
          preserveAspectRatio="none"
        >
          <path
            fill="currentColor"
            d="M96 0 C64 80 12 150 20 270 C28 390 88 455 68 555 C48 655 0 735 24 820 C40 875 72 892 96 900 L96 0 Z"
          />
        </svg>
      </aside>

      <main className="staff-login-form-pane">
        <div className="staff-login-mobile-bar">
          <span className="staff-login-logo-mark" aria-hidden>
            TG
          </span>
          <span>TrueGage Staff</span>
        </div>
        <form className="staff-login-form" onSubmit={(e) => void onSubmit(e)}>
          <p className="staff-login-form-kicker">Master Admin</p>
          <h2>Sign in to Staff Console</h2>
          <p className="staff-login-form-sub">
            Password and 6-digit staff passcode required. Access denied for organization users.
          </p>
          {error && <p className="error">{error}</p>}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="passcode">Staff passcode</label>
            <input
              id="passcode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary staff-login-submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to Staff Console"}
          </button>
          <p className="staff-login-denied">
            Not TrueGage staff? Sign in at the customer app — this portal will reject workspace accounts.
          </p>
        </form>
      </main>
    </div>
  );
}
