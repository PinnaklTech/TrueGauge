import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  getEmailQueue,
  getPlatformSmtp,
  savePlatformSmtp,
  testPlatformSmtp,
} from "@/lib/api";

const STATUS_TABS = [
  { id: "", label: "All" },
  { id: "failed", label: "Failed" },
  { id: "sent", label: "Sent" },
] as const;

const KIND_TABS = [
  { id: "", label: "All kinds" },
  { id: "welcome", label: "Welcome" },
  { id: "overdue_alert", label: "Overdue alerts" },
  { id: "check", label: "Checks" },
] as const;

export function EmailQueuePage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["email-queue", status, kind],
    queryFn: () => getEmailQueue(status, kind, 100),
  });

  return (
    <div>
      <h1 className="page-title">Email</h1>
      <p className="page-sub">
        Platform email delivery for onboarding, plus a live audit of outbound messages.
      </p>

      <PlatformSmtpPanel />

      <h2 className="page-title" style={{ fontSize: "1.05rem", marginTop: "1.75rem", marginBottom: 0 }}>
        Outbound queue
      </h2>
      <p className="page-sub">
        Jump into a company to resend welcome mail or inspect delivery failures.
      </p>

      <div className="tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id || "all-status"}
            type="button"
            className={`tab ${status === t.id ? "tab-active" : ""}`}
            onClick={() => setStatus(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabs">
        {KIND_TABS.map((t) => (
          <button
            key={t.id || "all-kind"}
            type="button"
            className={`tab ${kind === t.id ? "tab-active" : ""}`}
            onClick={() => setKind(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error instanceof Error ? error.message : "Failed"}</p>}
      {isLoading && <p className="muted">Loading…</p>}

      {data && (
        <div className="panel">
          <div className="panel-head">
            <h2>Recent emails</h2>
            <span className="muted mono">{data.total} shown</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Company</th>
                  <th>Kind</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td>
                      {row.tenant_id ? (
                        <Link to={`/companies/${row.tenant_id}`}>
                          {row.tenant_name || `#${row.tenant_id}`}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono">{row.kind}</td>
                    <td className="mono">{row.to_email}</td>
                    <td>
                      {row.subject}
                      {row.error && (
                        <div className="muted" style={{ fontSize: "0.8rem" }}>
                          {row.error}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          row.status === "sent"
                            ? "badge-ok"
                            : row.status === "failed"
                              ? "badge-warn"
                              : "badge-off"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No emails match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformSmtpPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-smtp"],
    queryFn: getPlatformSmtp,
  });
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useTls, setUseTls] = useState(true);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("TrueGage");
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(true);

  useEffect(() => {
    if (!data) return;
    setHost(data.smtp_host || "");
    setPort(String(data.smtp_port ?? 587));
    setUsername(data.smtp_username || "");
    setUseTls(data.smtp_use_tls);
    setFromEmail(data.smtp_from_email || "");
    setFromName(data.smtp_from_name || "TrueGage");
    setPassword("");
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!host.trim() || !fromEmail.trim()) {
        throw new Error("SMTP host and From email are required");
      }
      const portNum = Number(port);
      if (!Number.isFinite(portNum) || portNum < 1) {
        throw new Error("Enter a valid SMTP port");
      }
      return savePlatformSmtp({
        smtp_host: host.trim(),
        smtp_port: portNum,
        smtp_username: username.trim() || undefined,
        smtp_password: password.trim() || undefined,
        smtp_use_tls: useTls,
        smtp_from_email: fromEmail.trim(),
        smtp_from_name: fromName.trim() || "TrueGage",
      });
    },
    onSuccess: () => {
      setPassword("");
      setMsgOk(true);
      setMsg("Email delivery settings saved");
      void qc.invalidateQueries({ queryKey: ["platform-smtp"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e: Error) => {
      setMsgOk(false);
      setMsg(e.message);
    },
  });

  const testMut = useMutation({
    mutationFn: () => testPlatformSmtp(testTo.trim()),
    onSuccess: (r) => {
      setMsgOk(true);
      setMsg(r.message);
      setTestOpen(false);
      setTestTo("");
    },
    onError: (e: Error) => {
      setMsgOk(false);
      setMsg(e.message);
    },
  });

  return (
    <>
      <div className="settings-block">
        <div className="settings-block-head">
          <div>
            <h2>Email Delivery</h2>
            <p>
              Configure the From address and SMTP server used for company onboarding and welcome
              emails.
            </p>
          </div>
        </div>

        {error && (
          <p className="error">{error instanceof Error ? error.message : "Failed to load"}</p>
        )}
        {isLoading && <p className="muted">Loading email settings…</p>}

        {data && (
          <>
            <div className="status-row">
              {data.configured ? (
                <span className="status-pill status-pill-ok">
                  <IconCheck /> SMTP configured
                  {data.source === "env" ? " (env)" : ""}
                </span>
              ) : (
                <span className="status-pill status-pill-warn">
                  <IconAlert /> Not configured yet
                </span>
              )}
              {data.last_error && (
                <span className="error" style={{ fontSize: "0.75rem" }}>
                  {data.last_error}
                </span>
              )}
            </div>

            <div className="fields-grid">
              <div className="field">
                <label htmlFor="smtp-from-name">From name</label>
                <input
                  id="smtp-from-name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="TrueGage"
                />
              </div>
              <div className="field">
                <label htmlFor="smtp-from-email">From email</label>
                <input
                  id="smtp-from-email"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="alerts@yourcompany.com"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="smtp-host">SMTP host</label>
                <input
                  id="smtp-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.yourprovider.com"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="smtp-port">SMTP port</label>
                <input
                  id="smtp-port"
                  type="number"
                  min={1}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                />
              </div>
              <div className="field">
                <label htmlFor="smtp-user">SMTP username</label>
                <input
                  id="smtp-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Usually your mailbox address"
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="smtp-pass">SMTP password</label>
                <input
                  id="smtp-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    data.has_password
                      ? "Leave blank to keep current password"
                      : "App password or SMTP secret"
                  }
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="setting-toggle">
              <div className="setting-toggle-copy">
                <div className="setting-toggle-title">Use TLS</div>
                <div className="setting-toggle-sub">
                  STARTTLS on 587, or SSL on 465. Leave on for most providers.
                </div>
              </div>
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={useTls}
                aria-label="Use TLS"
                onClick={() => setUseTls((v) => !v)}
              >
                <span className="switch-knob" />
              </button>
            </div>

            {msg && <p className={msgOk ? "muted" : "error"}>{msg}</p>}

            <div className="panel-footer">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!data.configured || testMut.isPending}
                onClick={() => {
                  setMsg("");
                  setTestOpen(true);
                }}
              >
                <IconSend />
                Send check email
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saveMut.isPending}
                onClick={() => {
                  setMsg("");
                  saveMut.mutate();
                }}
              >
                {saveMut.isPending ? "Saving…" : "Save email settings"}
              </button>
            </div>
          </>
        )}
      </div>

      {testOpen && (
        <div
          className="dialog-backdrop"
          onClick={() => !testMut.isPending && setTestOpen(false)}
        >
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (!testTo.trim()) return;
              testMut.mutate();
            }}
          >
            <h3>Send check email</h3>
            <p>Sends a short delivery check so you can confirm SMTP credentials and TLS.</p>
            <div className="field">
              <label htmlFor="smtp-test-to">Recipient email</label>
              <input
                id="smtp-test-to"
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={testMut.isPending}
                onClick={() => setTestOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={testMut.isPending || !testTo.trim()}
              >
                {testMut.isPending ? "Sending…" : "Send check"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4 12 14.01l-3-3" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
