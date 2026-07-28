import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { APP_URL, createTenant, listTenants } from "@/lib/api";

function genTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let out = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out + "Aa1!";
}

export function CompaniesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenants"],
    queryFn: listTenants,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [sendWelcome, setSendWelcome] = useState(true);
  const [formError, setFormError] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [smtpFilter, setSmtpFilter] = useState<"all" | "yes" | "no">("all");

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const term = q.trim().toLowerCase();
    return items
      .filter((t) => {
        if (statusFilter === "active" && !t.active) return false;
        if (statusFilter === "suspended" && t.active) return false;
        if (smtpFilter === "yes" && !t.smtp_configured) return false;
        if (smtpFilter === "no" && t.smtp_configured) return false;
        if (!term) return true;
        return t.name.toLowerCase().includes(term) || t.slug.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
  }, [data?.items, q, statusFilter, smtpFilter]);

  const createMut = useMutation({
    mutationFn: createTenant,
    onSuccess: async () => {
      setOpen(false);
      setName("");
      setSlug("");
      setAdminEmail("");
      setAdminPassword("");
      setAdminFullName("");
      setSendWelcome(true);
      setFormError("");
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Company name is required");
      return;
    }
    const cleanedSlug = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!cleanedSlug) {
      setFormError("Company slug is required (e.g. acme-metrology)");
      return;
    }
    if (cleanedSlug.length < 2) {
      setFormError("Slug must be at least 2 characters");
      return;
    }
    if (!adminEmail.trim() || !adminPassword) {
      setFormError("Company admin email and password are required");
      return;
    }
    if (adminPassword.length < 12) {
      setFormError("Admin password must be at least 12 characters");
      return;
    }
    createMut.mutate({
      name: name.trim(),
      slug: cleanedSlug,
      admin_email: adminEmail.trim(),
      admin_password: adminPassword,
      admin_full_name: adminFullName.trim() || undefined,
      send_welcome_email: sendWelcome,
    });
  };

  return (
    <div>
      <h1 className="page-title">Companies</h1>
      <p className="page-sub">
        Onboard a workspace and provision the company admin. Open a company for the full ops cockpit.
      </p>

      <div className="toolbar">
        <input
          placeholder="Search name or slug…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            padding: "0.55rem 0.75rem",
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={smtpFilter}
          onChange={(e) => setSmtpFilter(e.target.value as typeof smtpFilter)}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            padding: "0.55rem 0.75rem",
          }}
        >
          <option value="all">SMTP any</option>
          <option value="yes">SMTP configured</option>
          <option value="no">SMTP missing</option>
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setAdminPassword(genTempPassword());
            setOpen(true);
          }}
        >
          Onboard company
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>All companies</h2>
          <span className="muted mono">
            {filtered.length}
            {data ? ` / ${data.total}` : ""}
          </span>
        </div>
        {error && (
          <p className="error" style={{ padding: "0.75rem 1.1rem" }}>
            {error instanceof Error ? error.message : "Failed"}
          </p>
        )}
        {isLoading && (
          <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>
            Loading…
          </p>
        )}
        {data && (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Slug</th>
                <th>Users</th>
                <th>SMTP</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/companies/${t.id}`}>{t.name}</Link>
                  </td>
                  <td className="mono muted">
                    <div>{t.slug}</div>
                    <div style={{ fontSize: "0.7rem", opacity: 0.75 }}>
                      /workspace/{t.slug}
                    </div>
                  </td>
                  <td className="mono">{t.user_count}</td>
                  <td>
                    <span className={`badge ${t.smtp_configured ? "badge-ok" : "badge-warn"}`}>
                      {t.smtp_configured ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="muted">
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    <span className={`badge ${t.active ? "badge-ok" : "badge-off"}`}>
                      {t.active ? "Active" : "Suspended"}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No companies match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="dialog-backdrop" onClick={() => !createMut.isPending && setOpen(false)}>
          <form className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} onSubmit={onCreate}>
            <h3>Onboard company</h3>
            <p>
              Creates the tenant workspace and a required company admin. Optionally emails login details from
              TrueGage to the client.
            </p>
            {formError && <p className="error">{formError}</p>}
            <div className="field">
              <label htmlFor="co-name">Company name</label>
              <input id="co-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="co-slug">Company slug *</label>
              <input
                id="co-slug"
                className="mono"
                value={slug}
                placeholder="acme-metrology"
                required
                onChange={(e) =>
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]+/g, "-")
                      .replace(/--+/g, "-"),
                  )
                }
              />
              <p className="muted" style={{ fontSize: "0.75rem", margin: "0.35rem 0 0" }}>
                Workspace URL:{" "}
                <span className="mono">
                  {APP_URL}/workspace/{slug.trim() || "…"}
                </span>
              </p>
            </div>
            <div className="field-divider">Company administrator</div>
            <div className="field">
              <label htmlFor="co-admin-name">Admin full name</label>
              <input
                id="co-admin-name"
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="co-admin-email">Admin email</label>
              <input
                id="co-admin-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="co-admin-pw">Temporary password (min 12)</label>
              <input
                id="co-admin-pw"
                type="text"
                className="mono"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: "0.4rem" }}
                onClick={() => setAdminPassword(genTempPassword())}
              >
                Regenerate
              </button>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={sendWelcome}
                onChange={(e) => setSendWelcome(e.target.checked)}
              />
              Send welcome email from TrueGage to this admin
            </label>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
                {createMut.isPending ? "Provisioning…" : "Provision & onboard"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
