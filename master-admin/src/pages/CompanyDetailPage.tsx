import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  APP_URL,
  createHandoffCode,
  createTenantUser,
  deleteTenant,
  forcePassword,
  getTenant,
  getTenantActivity,
  getTenantEmailHistory,
  getTenantEquipment,
  getTenantSummary,
  listTenantUsers,
  type OrgRole,
  type OrgUser,
  resendWelcomeEmail,
  revokeTenantUserSessions,
  updateTenant,
  updateTenantOrg,
  updateTenantUser,
} from "@/lib/api";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "org", label: "Org profile" },
  { id: "integrations", label: "Integrations" },
  { id: "email", label: "Email" },
  { id: "fleet", label: "Fleet" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function genTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let out = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out + "Aa1!";
}

export function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tenantId = Number(id);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("overview");
  const [msg, setMsg] = useState("");
  const [opening, setOpening] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => getTenant(tenantId),
    enabled: Number.isFinite(tenantId),
  });

  useEffect(() => {
    if (data?.slug && !editingSlug) setSlugDraft(data.slug);
  }, [data?.slug, editingSlug]);
  const summaryQ = useQuery({
    queryKey: ["tenant-summary", tenantId],
    queryFn: () => getTenantSummary(tenantId),
    enabled: Number.isFinite(tenantId),
  });
  const usersQ = useQuery({
    queryKey: ["tenant-users", tenantId],
    queryFn: () => listTenantUsers(tenantId),
    enabled: Number.isFinite(tenantId) && (tab === "members" || tab === "overview"),
  });
  const emailQ = useQuery({
    queryKey: ["tenant-email", tenantId],
    queryFn: () => getTenantEmailHistory(tenantId, "", 60),
    enabled: Number.isFinite(tenantId) && tab === "email",
  });
  const emailUsersQ = useQuery({
    queryKey: ["tenant-users", tenantId],
    queryFn: () => listTenantUsers(tenantId),
    enabled: Number.isFinite(tenantId) && tab === "email",
  });
  const fleetQ = useQuery({
    queryKey: ["tenant-fleet", tenantId, "all"],
    queryFn: () => getTenantEquipment(tenantId, "", 100),
    enabled: Number.isFinite(tenantId) && tab === "fleet",
  });
  const activityQ = useQuery({
    queryKey: ["tenant-activity", tenantId],
    queryFn: () => getTenantActivity(tenantId, 60),
    enabled: Number.isFinite(tenantId) && tab === "activity",
  });

  const invalidateCompany = async () => {
    await queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
    await queryClient.invalidateQueries({ queryKey: ["tenant-summary", tenantId] });
    await queryClient.invalidateQueries({ queryKey: ["tenant-users", tenantId] });
    await queryClient.invalidateQueries({ queryKey: ["tenants"] });
    await queryClient.invalidateQueries({ queryKey: ["overview"] });
    await queryClient.invalidateQueries({ queryKey: ["activity"] });
    await queryClient.invalidateQueries({ queryKey: ["platform-users"] });
  };

  const saveMut = useMutation({
    mutationFn: (payload: {
      name?: string;
      slug?: string;
      active?: boolean;
      storage_enabled?: boolean;
    }) => updateTenant(tenantId, payload),
    onSuccess: async (_data, vars) => {
      if (typeof vars.storage_enabled === "boolean") {
        setMsg(vars.storage_enabled ? "Certificate vault enabled" : "Certificate vault disabled");
      } else if (typeof vars.active === "boolean") {
        setMsg(vars.active ? "Company activated" : "Company suspended");
      } else if (typeof vars.slug === "string") {
        setMsg("Company slug updated");
        setEditingSlug(false);
      } else {
        setMsg("Company updated");
      }
      await invalidateCompany();
      await queryClient.invalidateQueries({ queryKey: ["tenant-activity", tenantId] });
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteTenant(tenantId, deleteConfirm.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      navigate("/companies");
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const saveSlug = () => {
    const cleaned = slugDraft
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (cleaned.length < 2) {
      setMsg("Slug must be at least 2 characters");
      return;
    }
    if (cleaned === data?.slug) {
      setEditingSlug(false);
      return;
    }
    saveMut.mutate({ slug: cleaned });
  };
  const openCompany = async () => {
    setOpening(true);
    setMsg("");
    try {
      const handoff = await createHandoffCode(tenantId);
      // Fragment keeps the one-time code out of server access logs / Referer.
      const url = `${APP_URL}/auth/handoff#code=${encodeURIComponent(handoff.code)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      await queryClient.invalidateQueries({ queryKey: ["activity"] });
      await queryClient.invalidateQueries({ queryKey: ["tenant-activity", tenantId] });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not open company");
    } finally {
      setOpening(false);
    }
  };

  if (!Number.isFinite(tenantId)) {
    return <p className="error">Invalid company id</p>;
  }

  const summary = summaryQ.data;

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/companies">← Companies</Link>
      </p>
      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error instanceof Error ? error.message : "Failed"}</p>}

      {data && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>
                {data.name}
              </h1>
              <p className="page-sub" style={{ marginBottom: 0 }}>
                {editingSlug ? (
                  <span className="row" style={{ gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      className="mono"
                      value={slugDraft}
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text)",
                        padding: "0.35rem 0.55rem",
                        minWidth: 180,
                      }}
                      onChange={(e) =>
                        setSlugDraft(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9-]+/g, "-")
                            .replace(/--+/g, "-"),
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveSlug();
                        }
                        if (e.key === "Escape") {
                          setSlugDraft(data.slug);
                          setEditingSlug(false);
                        }
                      }}
                      aria-label="Company slug"
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                      disabled={saveMut.isPending}
                      onClick={saveSlug}
                    >
                      Save slug
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                      disabled={saveMut.isPending}
                      onClick={() => {
                        setSlugDraft(data.slug);
                        setEditingSlug(false);
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    <span className="mono">{data.slug}</span>
                    {" "}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "0.15rem 0.45rem", fontSize: "0.7rem" }}
                      onClick={() => {
                        setSlugDraft(data.slug);
                        setEditingSlug(true);
                      }}
                    >
                      Edit slug
                    </button>
                  </>
                )}
                {" · "}
                <span className={`badge ${data.active ? "badge-ok" : "badge-off"}`}>
                  {data.active ? "Active" : "Suspended"}
                </span>
                {" · "}
                <span className={`badge ${data.storage_enabled ? "badge-ok" : "badge-warn"}`}>
                  {data.storage_enabled ? "Vault on" : "Vault off"}
                </span>
              </p>
              <p className="muted" style={{ marginTop: "0.45rem", marginBottom: 0, fontSize: "0.8rem" }}>
                Workspace URL:{" "}
                <a
                  className="mono"
                  href={`${APP_URL.replace(/\/$/, "")}/workspace/${editingSlug ? slugDraft || data.slug : data.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {APP_URL.replace(/\/$/, "")}/workspace/
                  {editingSlug ? slugDraft || data.slug : data.slug}
                </a>{" "}
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "0.15rem 0.45rem", fontSize: "0.7rem" }}
                  onClick={() => {
                    const url = `${APP_URL.replace(/\/$/, "")}/workspace/${data.slug}`;
                    void navigator.clipboard.writeText(url).then(
                      () => setMsg("Workspace URL copied"),
                      () => setMsg("Could not copy URL"),
                    );
                  }}
                >
                  Copy
                </button>
              </p>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={opening || !data.active}
                onClick={() => void openCompany()}
              >
                {opening ? "Opening…" : "Open workspace"}
              </button>
              <button
                type="button"
                className={data.storage_enabled ? "btn" : "btn btn-primary"}
                disabled={saveMut.isPending}
                title="Enable or disable certificate vault for this company"
                onClick={() => saveMut.mutate({ storage_enabled: !data.storage_enabled })}
              >
                {data.storage_enabled ? "Disable vault" : "Enable vault"}
              </button>
              <button
                type="button"
                className={data.active ? "btn btn-danger" : "btn btn-primary"}
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate({ active: !data.active })}
              >
                {data.active ? "Suspend" : "Activate"}
              </button>
            </div>
          </div>
          {msg && (
            <p className={msg.toLowerCase().includes("fail") || msg.includes("Could") ? "error" : "muted"}>
              {msg}
            </p>
          )}

          <div className="tabs" style={{ marginTop: "1rem" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab ${tab === t.id ? "tab-active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              <OverviewTab
                summary={summary}
                loading={summaryQ.isLoading}
                userCount={usersQ.data?.total}
              />
              <div className="panel danger-zone">
                <div className="panel-head">
                  <h2>Danger zone</h2>
                </div>
                <div className="danger-row">
                  <div className="danger-row-copy">
                    <p className="danger-row-title">Delete this company</p>
                    <p className="danger-row-sub">
                      Permanently removes the workspace, members, and stored certificates. Suspend
                      instead if you only need to cut off access.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      setDeleteConfirm("");
                      setShowDelete(true);
                    }}
                  >
                    Delete company
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === "members" && (
            <MembersTab
              tenantId={tenantId}
              users={usersQ.data?.items ?? []}
              loading={usersQ.isLoading}
              onDone={async (m) => {
                setMsg(m);
                await invalidateCompany();
                await queryClient.invalidateQueries({ queryKey: ["tenant-email", tenantId] });
              }}
            />
          )}
          {tab === "org" && (
            <OrgTab
              tenantId={tenantId}
              initial={{
                company_name: data.company_name || data.name,
                industry: data.industry || "",
                address: data.address || "",
                timezone: data.timezone || "UTC",
                accent_color: data.accent_color || "#0f766e",
              }}
              onDone={async (m) => {
                setMsg(m);
                await invalidateCompany();
              }}
            />
          )}
          {tab === "integrations" && <IntegrationsTab summary={summary} />}
          {tab === "email" && (
            <EmailTab
              tenantId={tenantId}
              items={emailQ.data?.items ?? []}
              loading={emailQ.isLoading}
              users={emailUsersQ.data?.items ?? usersQ.data?.items ?? []}
              onDone={async (m) => {
                setMsg(m);
                await queryClient.invalidateQueries({ queryKey: ["tenant-email", tenantId] });
                await queryClient.invalidateQueries({ queryKey: ["email-queue"] });
                await queryClient.invalidateQueries({ queryKey: ["activity"] });
                await invalidateCompany();
              }}
            />
          )}
          {tab === "fleet" && (
            <FleetTab items={fleetQ.data?.items ?? []} loading={fleetQ.isLoading} summary={summary} />
          )}
          {tab === "activity" && (
            <CompanyActivityTab items={activityQ.data?.items ?? []} loading={activityQ.isLoading} />
          )}

          {showDelete && (
            <div
              className="dialog-backdrop"
              onClick={() => !deleteMut.isPending && setShowDelete(false)}
            >
              <form
                className="dialog"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (deleteConfirm.trim() !== data.slug) return;
                  setMsg("");
                  deleteMut.mutate();
                }}
              >
                <h3>Delete {data.name}?</h3>
                <p>
                  This permanently deletes the company workspace and cannot be undone. Type the slug{" "}
                  <span className="confirm-slug">{data.slug}</span> to confirm.
                </p>
                <div className="field">
                  <label htmlFor="delete-confirm-slug">Company slug</label>
                  <input
                    id="delete-confirm-slug"
                    className="mono"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={data.slug}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={deleteMut.isPending}
                    onClick={() => {
                      setShowDelete(false);
                      setDeleteConfirm("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-danger-solid"
                    disabled={deleteMut.isPending || deleteConfirm.trim() !== data.slug}
                  >
                    {deleteMut.isPending ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OverviewTab({
  summary,
  loading,
  userCount,
}: {
  summary: Awaited<ReturnType<typeof getTenantSummary>> | undefined;
  loading: boolean;
  userCount?: number;
}) {
  if (loading && !summary) return <p className="muted">Loading summary…</p>;
  if (!summary) return <p className="muted">No summary.</p>;
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Users</div>
          <div className="kpi-value">
            {summary.active_user_count}
            <span className="kpi-suffix">/ {userCount ?? summary.user_count}</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Admins</div>
          <div className="kpi-value">{summary.admin_count}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Equipment</div>
          <div className="kpi-value">{summary.equipment_count}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Overdue</div>
          <div className="kpi-value">{summary.overdue_count}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Calibrations</div>
          <div className="kpi-value">{summary.calibration_count}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Certificate vault</div>
          <div className="kpi-value" style={{ fontSize: "1.15rem" }}>
            {summary.storage_enabled
              ? `${formatStorageBytes(summary.storage_used_bytes)} / 2 GB`
              : "Off"}
          </div>
          {summary.storage_enabled ? (
            <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
              {summary.certificate_count} file{summary.certificate_count === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
        <div className="kpi">
          <div className="kpi-label">Email 7d</div>
          <div className="kpi-value">
            {summary.email_7d_sent}
            <span className="kpi-suffix fail">· {summary.email_7d_failed} fail</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Onboarding checklist</h2>
        </div>
        <ul className="checklist">
          {summary.checklist.map((c) => (
            <li key={c.id} className={c.done ? "done" : ""}>
              <span className={`badge ${c.done ? "badge-ok" : "badge-warn"}`}>
                {c.done ? "Done" : "Todo"}
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Signals</h2>
        </div>
        <div className="detail-grid" style={{ padding: "1rem 1.1rem" }}>
          <div className="detail-item">
            <div className="label">Last auth</div>
            <div>{summary.last_auth_at ? new Date(summary.last_auth_at).toLocaleString() : "—"}</div>
          </div>
          <div className="detail-item">
            <div className="label">Last email</div>
            <div>{summary.last_email_at ? new Date(summary.last_email_at).toLocaleString() : "—"}</div>
          </div>
          <div className="detail-item">
            <div className="label">SMTP</div>
            <div>{summary.smtp_configured ? "Configured" : "Not set"}</div>
          </div>
          <div className="detail-item">
            <div className="label">Odoo</div>
            <div>{summary.odoo_configured ? "Configured" : "Not set"}</div>
          </div>
          <div className="detail-item">
            <div className="label">Certificate vault</div>
            <div>
              {summary.storage_enabled
                ? `Enabled · ${formatStorageBytes(summary.storage_used_bytes)} of 2 GB`
                : "Not included (staff can enable)"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function MembersTab({
  tenantId,
  users,
  loading,
  onDone,
}: {
  tenantId: number;
  users: OrgUser[];
  loading: boolean;
  onDone: (msg: string) => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<OrgUser | null>(null);
  const [welcomeUser, setWelcomeUser] = useState<OrgUser | null>(null);
  const [editUser, setEditUser] = useState<OrgUser | null>(null);
  const [formError, setFormError] = useState("");

  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cRole, setCRole] = useState<OrgRole>("admin");
  const [cPassword, setCPassword] = useState("");

  const [tempPassword, setTempPassword] = useState("");
  const [eName, setEName] = useState("");
  const [eRole, setERole] = useState<OrgRole>("member");

  useEffect(() => {
    if (editUser) {
      setEName(editUser.full_name || "");
      setERole((editUser.role as OrgRole) || "member");
    }
  }, [editUser]);

  const createMut = useMutation({
    mutationFn: () =>
      createTenantUser(tenantId, {
        email: cEmail.trim(),
        password: cPassword,
        full_name: cName.trim() || undefined,
        role: cRole,
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      setCName("");
      setCEmail("");
      setCPassword("");
      setCRole("admin");
      setFormError("");
      await onDone("User created");
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const resetMut = useMutation({
    mutationFn: () => forcePassword(tenantId, resetUser!.id, tempPassword),
    onSuccess: async () => {
      setResetUser(null);
      setTempPassword("");
      setFormError("");
      await onDone("Password reset — sessions revoked");
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const welcomeMut = useMutation({
    mutationFn: () =>
      resendWelcomeEmail(tenantId, { user_id: welcomeUser!.id, password: tempPassword }),
    onSuccess: async (res) => {
      setWelcomeUser(null);
      setTempPassword("");
      setFormError("");
      await onDone(
        res.status === "sent"
          ? "Welcome email sent"
          : `Welcome email failed: ${res.error || res.status}`,
      );
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const editMut = useMutation({
    mutationFn: () =>
      updateTenantUser(tenantId, editUser!.id, {
        full_name: eName.trim(),
        role: eRole,
      }),
    onSuccess: async () => {
      setEditUser(null);
      setFormError("");
      await onDone("Member updated");
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const toggleMut = useMutation({
    mutationFn: (u: OrgUser) => updateTenantUser(tenantId, u.id, { active: !u.active }),
    onSuccess: async () => onDone("Member status updated"),
    onError: (err: Error) => void onDone(err.message),
  });

  const revokeMut = useMutation({
    mutationFn: (u: OrgUser) => revokeTenantUserSessions(tenantId, u.id),
    onSuccess: async () => onDone("Sessions revoked"),
    onError: (err: Error) => void onDone(err.message),
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Login members</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setCPassword(genTempPassword());
            setFormError("");
            setCreateOpen(true);
          }}
        >
          Add member
        </button>
      </div>
      {loading && (
        <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>
          Loading…
        </p>
      )}
      {!loading && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name || "—"}</td>
                <td className="mono">{u.email}</td>
                <td className="mono">{u.role}</td>
                <td>
                  <span className={`badge ${u.active !== false ? "badge-ok" : "badge-off"}`}>
                    {u.active !== false ? "Active" : "Disabled"}
                  </span>
                </td>
                <td>
                  <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditUser(u)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setResetUser(u);
                        setTempPassword(genTempPassword());
                        setFormError("");
                      }}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setWelcomeUser(u);
                        setTempPassword(genTempPassword());
                        setFormError("");
                      }}
                    >
                      Welcome email
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={revokeMut.isPending}
                      onClick={() => revokeMut.mutate(u)}
                    >
                      Revoke sessions
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={toggleMut.isPending}
                      onClick={() => toggleMut.mutate(u)}
                    >
                      {u.active !== false ? "Disable" : "Enable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No login members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {createOpen && (
        <div className="dialog-backdrop" onClick={() => !createMut.isPending && setCreateOpen(false)}>
          <form
            className="dialog dialog-wide"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (cPassword.length < 12) {
                setFormError("Password must be at least 12 characters");
                return;
              }
              createMut.mutate();
            }}
          >
            <h3>Add company member</h3>
            <p>Creates a login account in this workspace.</p>
            {formError && <p className="error">{formError}</p>}
            <div className="field">
              <label>Full name</label>
              <input value={cName} onChange={(e) => setCName(e.target.value)} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={cRole} onChange={(e) => setCRole(e.target.value as OrgRole)}>
                <option value="admin">admin</option>
                <option value="qa">qa</option>
                <option value="technician">technician</option>
                <option value="member">member</option>
              </select>
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input
                className="mono"
                value={cPassword}
                onChange={(e) => setCPassword(e.target.value)}
                required
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {resetUser && (
        <PasswordDialog
          title="Force password"
          subtitle={`Reset password for ${resetUser.email}. Sessions will be revoked.`}
          password={tempPassword}
          setPassword={setTempPassword}
          error={formError}
          pending={resetMut.isPending}
          onClose={() => setResetUser(null)}
          onSubmit={() => resetMut.mutate()}
        />
      )}

      {welcomeUser && (
        <PasswordDialog
          title="Resend welcome email"
          subtitle={`Sets a new temporary password and emails ${welcomeUser.email} from TrueGage.`}
          password={tempPassword}
          setPassword={setTempPassword}
          error={formError}
          pending={welcomeMut.isPending}
          submitLabel="Send welcome"
          onClose={() => setWelcomeUser(null)}
          onSubmit={() => welcomeMut.mutate()}
        />
      )}

      {editUser && (
        <div className="dialog-backdrop" onClick={() => !editMut.isPending && setEditUser(null)}>
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              editMut.mutate();
            }}
          >
            <h3>Edit member</h3>
            {formError && <p className="error">{formError}</p>}
            <div className="field">
              <label>Full name</label>
              <input value={eName} onChange={(e) => setEName(e.target.value)} />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={eRole} onChange={(e) => setERole(e.target.value as OrgRole)}>
                <option value="admin">admin</option>
                <option value="qa">qa</option>
                <option value="technician">technician</option>
                <option value="member">member</option>
              </select>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditUser(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={editMut.isPending}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PasswordDialog({
  title,
  subtitle,
  password,
  setPassword,
  error,
  pending,
  onClose,
  onSubmit,
  submitLabel = "Save",
}: {
  title: string;
  subtitle: string;
  password: string;
  setPassword: (v: string) => void;
  error: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="dialog-backdrop" onClick={() => !pending && onClose()}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (password.length < 12) return;
          onSubmit();
        }}
      >
        <h3>{title}</h3>
        <p>{subtitle}</p>
        {error && <p className="error">{error}</p>}
        <div className="field">
          <label>Temporary password (min 12)</label>
          <input
            className="mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: "0.4rem" }}
            onClick={() => setPassword(genTempPassword())}
          >
            Regenerate
          </button>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function OrgTab({
  tenantId,
  initial,
  onDone,
}: {
  tenantId: number;
  initial: {
    company_name: string;
    industry: string;
    address: string;
    timezone: string;
    accent_color: string;
  };
  onDone: (msg: string) => Promise<void>;
}) {
  const [companyName, setCompanyName] = useState(initial.company_name);
  const [industry, setIndustry] = useState(initial.industry);
  const [address, setAddress] = useState(initial.address);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [accent, setAccent] = useState(initial.accent_color);
  const [err, setErr] = useState("");

  useEffect(() => {
    setCompanyName(initial.company_name);
    setIndustry(initial.industry);
    setAddress(initial.address);
    setTimezone(initial.timezone);
    setAccent(initial.accent_color);
  }, [initial]);

  const mut = useMutation({
    mutationFn: () =>
      updateTenantOrg(tenantId, {
        company_name: companyName,
        industry,
        address,
        timezone,
        accent_color: accent,
      }),
    onSuccess: async () => {
      setErr("");
      await onDone("Organization profile saved");
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Organization profile</h2>
      </div>
      <form
        style={{ padding: "1rem 1.1rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        {err && <p className="error">{err}</p>}
        <div className="field">
          <label>Company name</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Industry</label>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </div>
        <div className="field">
          <label>Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field">
          <label>Timezone</label>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="field">
          <label>Accent color</label>
          <input value={accent} onChange={(e) => setAccent(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={mut.isPending}>
          Save profile
        </button>
      </form>
    </div>
  );
}

function IntegrationsTab({
  summary,
}: {
  summary: Awaited<ReturnType<typeof getTenantSummary>> | undefined;
}) {
  if (!summary) return <p className="muted">Loading…</p>;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Integrations (read-only)</h2>
        <span className="muted">Secrets are never shown</span>
      </div>
      <div className="detail-grid" style={{ padding: "1rem 1.1rem" }}>
        <div className="detail-item">
          <div className="label">Company SMTP</div>
          <div>
            <span className={`badge ${summary.smtp_configured ? "badge-ok" : "badge-warn"}`}>
              {summary.smtp_configured ? "Configured" : "Not set"}
            </span>
          </div>
        </div>
        <div className="detail-item">
          <div className="label">SMTP host</div>
          <div className="mono">{summary.smtp_host || "—"}</div>
        </div>
        <div className="detail-item">
          <div className="label">From email</div>
          <div className="mono">{summary.smtp_from_email || "—"}</div>
        </div>
        <div className="detail-item">
          <div className="label">Platform SMTP (welcome)</div>
          <div>
            <span className={`badge ${summary.system_smtp_ready ? "badge-ok" : "badge-warn"}`}>
              {summary.system_smtp_ready ? "Ready" : "Not set"}
            </span>
          </div>
        </div>
        <div className="detail-item">
          <div className="label">Odoo</div>
          <div>
            <span className={`badge ${summary.odoo_configured ? "badge-ok" : "badge-warn"}`}>
              {summary.odoo_configured ? "Configured" : "Not set"}
            </span>
            {summary.odoo_connected ? " · connected" : ""}
          </div>
        </div>
        <div className="detail-item">
          <div className="label">Odoo URL</div>
          <div className="mono">{summary.odoo_url || "—"}</div>
        </div>
        <div className="detail-item" style={{ gridColumn: "1 / -1" }}>
          <div className="label">Odoo last error</div>
          <div className="muted">{summary.odoo_last_error || "—"}</div>
        </div>
      </div>
    </div>
  );
}

function EmailTab({
  tenantId,
  items,
  loading,
  users,
  onDone,
}: {
  tenantId: number;
  items: Awaited<ReturnType<typeof getTenantEmailHistory>>["items"];
  loading: boolean;
  users: OrgUser[];
  onDone: (msg: string) => Promise<void>;
}) {
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [userId, setUserId] = useState<number | "">("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      resendWelcomeEmail(tenantId, {
        password,
        user_id: typeof userId === "number" ? userId : undefined,
      }),
    onSuccess: async (res) => {
      setWelcomeOpen(false);
      await onDone(res.status === "sent" ? "Welcome email sent" : `Failed: ${res.error || res.status}`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Email history</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setPassword(genTempPassword());
            setErr("");
            setWelcomeOpen(true);
          }}
        >
          Resend welcome
        </button>
      </div>
      {loading && (
        <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>
          Loading…
        </p>
      )}
      {!loading && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>To</th>
              <th>Subject</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {new Date(row.created_at).toLocaleString()}
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
                  <span className={`badge ${row.status === "sent" ? "badge-ok" : "badge-off"}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No emails yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {welcomeOpen && (
        <div className="dialog-backdrop" onClick={() => !mut.isPending && setWelcomeOpen(false)}>
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
          >
            <h3>Resend welcome email</h3>
            {err && <p className="error">{err}</p>}
            <div className="field">
              <label>Admin (optional)</label>
              <select
                value={userId === "" ? "" : String(userId)}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">First active admin</option>
                {users
                  .filter((u) => u.role === "admin")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label>New temporary password</label>
              <input
                className="mono"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setWelcomeOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={mut.isPending}>
                Send
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function FleetTab({
  items,
  loading,
  summary,
}: {
  items: Awaited<ReturnType<typeof getTenantEquipment>>["items"];
  loading: boolean;
  summary: Awaited<ReturnType<typeof getTenantSummary>> | undefined;
}) {
  return (
    <>
      {summary && (
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-label">Equipment</div>
            <div className="kpi-value">{summary.equipment_count}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Overdue</div>
            <div className="kpi-value">{summary.overdue_count}</div>
          </div>
        </div>
      )}
      <div className="panel">
        <div className="panel-head">
          <h2>Equipment (read-only)</h2>
        </div>
        {loading && (
          <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>
            Loading…
          </p>
        )}
        {!loading && (
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th>Name</th>
                <th>Status</th>
                <th>Next cal</th>
                <th>Dept</th>
              </tr>
            </thead>
            <tbody>
              {items.map((eq) => (
                <tr key={eq.id}>
                  <td className="mono">{eq.tag || "—"}</td>
                  <td>{eq.name}</td>
                  <td>
                    <span
                      className={`badge ${
                        eq.status === "overdue"
                          ? "badge-off"
                          : eq.status === "calibrated"
                            ? "badge-ok"
                            : "badge-warn"
                      }`}
                    >
                      {eq.status}
                    </span>
                  </td>
                  <td className="mono muted">{eq.next_calibration || "—"}</td>
                  <td className="muted">{eq.department || "—"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No equipment in this workspace.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function CompanyActivityTab({
  items,
  loading,
}: {
  items: Awaited<ReturnType<typeof getTenantActivity>>["items"];
  loading: boolean;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Company activity</h2>
      </div>
      {loading && (
        <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>
          Loading…
        </p>
      )}
      {!loading && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Title</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                </td>
                <td className="mono">{item.kind}</td>
                <td>
                  <div>{item.title}</div>
                  {item.detail && (
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {item.detail}
                    </div>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${
                      item.status === "ok" || item.status === "sent"
                        ? "badge-ok"
                        : item.status === "failed" || item.status === "denied"
                          ? "badge-off"
                          : "badge-warn"
                    }`}
                  >
                    {item.status || "—"}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No activity for this company.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
