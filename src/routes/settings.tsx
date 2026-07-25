import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/tg/app-shell";
import {
  Building2,
  Users,
  Layers,
  BellRing,
  Plug,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Mail,
  Send,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getOdooStatus,
  saveOdooCredentials,
  syncOdooEquipment,
  testOdooConnection,
  listTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getEmailSettings,
  saveEmailSettings,
  sendEmailCheck,
  getOrgProfile,
  saveOrgProfileApi,
  getMe,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  type OdooStatus,
  type TeamMember,
  type EmailSettings,
  type AuthUser,
  type UserRole,
} from "@/lib/api";
import {
  defaultOrgProfile,
  roleDisplayLabel,
  type OrgProfile,
} from "@/lib/compliance";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { PageState } from "@/components/tg/page-state";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · TrueGage" }] }),
  component: SettingsPage,
});

const sections = [
  { id: "company", label: "Organization Profile", icon: Building2 },
  { id: "accounts", label: "Login accounts", icon: KeyRound },
  { id: "users", label: "Team & Notifications", icon: Users },
  { id: "email", label: "Email Delivery", icon: Mail },
  { id: "taxonomy", label: "Department Registers", icon: Layers },
  { id: "notifications", label: "Alarm & Reminder Rules", icon: BellRing },
  { id: "integrations", label: "ERP Integrations", icon: Plug },
];

function SettingsPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState("company");
  const [org, setOrg] = useState<OrgProfile>(defaultOrgProfile);
  const [ownerName, setOwnerName] = useState("Administrator");
  const [checkEmailOpen, setCheckEmailOpen] = useState(false);
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");

  useEffect(() => {
    void getMe()
      .then((u) => {
        if (u.role !== "admin" && u.role !== "platform_admin") {
          setAccess("denied");
          return;
        }
        setAccess("allowed");
        setOwnerName(u.full_name.trim() || "Administrator");
        return getOrgProfile().then((row) =>
          setOrg({
            companyName: row.company_name,
            industry: row.industry,
            address: row.address,
            timezone: row.timezone,
            accentColor: row.accent_color,
          }),
        );
      })
      .catch(() => setAccess("denied"));
  }, []);

  if (access === "loading") {
    return (
      <AppShell breadcrumbs={[{ label: "Settings" }]} hidePageHeader>
        <PageState variant="loading" title="Checking access…" className="border-0 bg-transparent" />
      </AppShell>
    );
  }

  if (access === "denied") {
    return (
      <AppShell breadcrumbs={[{ label: "Settings" }]} hidePageHeader>
        <PageState
          variant="empty"
          title="Admin access required"
          description="Only workspace admins can open Settings. Ask an admin if you need changes."
          action={{ label: "Back to dashboard", onClick: () => void navigate({ to: "/" }) }}
          className="border-0 bg-transparent"
        />
      </AppShell>
    );
  }

  const saveOrg = async () => {
    try {
      const saved = await saveOrgProfileApi({
        company_name: org.companyName,
        industry: org.industry,
        address: org.address,
        timezone: org.timezone,
        accent_color: org.accentColor,
      });
      setOrg({
        companyName: saved.company_name,
        industry: saved.industry,
        address: saved.address,
        timezone: saved.timezone,
        accentColor: saved.accent_color,
      });
      window.dispatchEvent(new CustomEvent("tg-org-profile-updated"));
      toast.success("Organization profile saved to database");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save organization profile");
    }
  };

  const openCheckEmail = () => {
    setActive("email");
    setCheckEmailOpen(true);
  };

  return (
    <AppShell breadcrumbs={[{ label: "Settings" }]} hidePageHeader>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            System Settings & Controls
          </h1>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            Org Owner: {ownerName}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Manage organization metadata, configure team roles, adjust automated warning alarms, and
          connect ERP platforms. Edit your personal admin account in{" "}
          <Link to="/profile" className="text-primary hover:underline">
            Profile
          </Link>
          .
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside>
          <nav className="space-y-0.5">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
                  {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {active === "company" && (
            <SettingsBlock
              title="Company Metadata & Custom Brand Settings"
              description="Workspace identity used in the sidebar and report headers."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Company Registered Name" htmlFor="org-company-name">
                    <Input
                      id="org-company-name"
                      value={org.companyName}
                      onChange={(e) => setOrg({ ...org, companyName: e.target.value })}
                      placeholder="Your company name"
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Industry Vertical" htmlFor="org-industry">
                    <Input
                      id="org-industry"
                      value={org.industry}
                      onChange={(e) => setOrg({ ...org, industry: e.target.value })}
                      placeholder="Medical Devices, Aerospace, Manufacturing…"
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="HQ Address" htmlFor="org-address">
                    <Input
                      id="org-address"
                      value={org.address}
                      onChange={(e) => setOrg({ ...org, address: e.target.value })}
                      placeholder="Street, city, region"
                    />
                  </Field>
                </div>
                <Field label="Local Timezone" htmlFor="org-timezone">
                  <select
                    id="org-timezone"
                    value={org.timezone}
                    onChange={(e) => setOrg({ ...org, timezone: e.target.value })}
                    className="tg-select"
                  >
                    <option value="UTC">UTC</option>
                    <option value="America/Chicago">Central Standard Time (CST)</option>
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="Europe/London">London (GMT/BST)</option>
                    <option value="Asia/Kolkata">India Standard Time (IST)</option>
                  </select>
                </Field>
                <Field label="Primary Color Palette Accent" htmlFor="org-accent">
                  <div className="flex items-center gap-2">
                    <input
                      id="org-accent"
                      type="color"
                      value={org.accentColor}
                      onChange={(e) => setOrg({ ...org, accentColor: e.target.value })}
                      className="h-10 w-12 cursor-pointer rounded-md border border-border bg-surface p-1"
                    />
                    <Input
                      value={org.accentColor}
                      onChange={(e) => setOrg({ ...org, accentColor: e.target.value })}
                      className="font-mono"
                      aria-label="Accent color hex"
                    />
                  </div>
                </Field>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => void saveOrg()}>Save Profile Settings</Button>
              </div>
            </SettingsBlock>
          )}

          {active === "accounts" && <LoginAccountsPanel />}

          {active === "users" && <TeamMembersPanel onSendCheckEmail={openCheckEmail} />}

          {active === "email" && (
            <EmailDeliveryPanel
              checkEmailOpen={checkEmailOpen}
              onCheckEmailOpenChange={setCheckEmailOpen}
            />
          )}

          {active === "taxonomy" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {["Departments", "Categories", "Locations"].map((t) => (
                <div key={t} className="rounded-xl border border-border bg-card shadow-xs">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h3 className="text-sm font-semibold">{t}</h3>
                    <Button variant="ghost" size="sm">
                      + Add
                    </Button>
                  </div>
                  <ul className="divide-y divide-border text-sm">
                    <li className="px-4 py-6 text-center text-muted-foreground">
                      No {t.toLowerCase()} yet.
                    </li>
                  </ul>
                </div>
              ))}
            </div>
          )}

          {active === "notifications" && (
            <SettingsBlock
              title="Alarm & Reminder Rules"
              description="Configure reminder thresholds. Emails use the From address and SMTP settings under Email Delivery."
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface/40 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Outbound mail is configured in{" "}
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => setActive("email")}
                  >
                    Email Delivery
                  </button>
                  .
                </p>
                <Button size="sm" variant="outline" onClick={openCheckEmail}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send check email
                </Button>
              </div>
              <div className="space-y-3">
                {(
                  [
                    ["30 days before due", true],
                    ["14 days before due", true],
                    ["7 days before due", true],
                    ["1 day before due", true],
                    ["Overdue (daily)", true],
                    ["Weekly digest", false],
                  ] as const
                ).map(([label, v]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">Email + in-app</div>
                    </div>
                    <Switch defaultChecked={v} />
                  </div>
                ))}
              </div>
            </SettingsBlock>
          )}

          {active === "integrations" && <OdooIntegrationPanel />}
        </div>
      </div>
    </AppShell>
  );
}

function LoginAccountsPanel() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [meId, setMeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [department, setDepartment] = useState("");
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("member");
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const refresh = async () => {
    try {
      const [list, me] = await Promise.all([listUsers(), getMe()]);
      setUsers(list.items);
      setMeId(me.id);
      setForbidden(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load users";
      if (msg.toLowerCase().includes("admin")) setForbidden(true);
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async () => {
    if (!email.trim() || !password.trim()) {
      toast.error("Email and password are required");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSaving(true);
    try {
      await createUser({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role,
        department: department.trim(),
      });
      toast.success("Login account created — they can sign in now");
      setShowForm(false);
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("member");
      setDepartment("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create user");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: AuthUser) => {
    setEditing(u);
    setEditName(u.full_name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditActive(u.active !== false);
    setEditPassword("");
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    setEditSaving(true);
    try {
      await updateUser(editing.id, {
        full_name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
        active: editActive,
        ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      });
      toast.success("Account updated");
      setEditing(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setEditSaving(false);
    }
  };

  const onToggleActive = async (u: AuthUser) => {
    try {
      await updateUser(u.id, { active: !(u.active !== false) });
      await refresh();
      toast.success(u.active !== false ? "Account deactivated" : "Account activated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (u: AuthUser) => {
    if (!confirm(`Delete login for ${u.email}? They will no longer be able to sign in.`)) return;
    try {
      await deleteUser(u.id);
      toast.success("Account deleted");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (forbidden) {
    return (
      <SettingsBlock
        title="Login accounts"
        description="Only admins can create and manage who can sign in to TrueGage."
      >
        <PageState
          variant="empty"
          title="Admin access required"
          description="Ask a workspace admin to grant you the Admin role, or create users for you."
          className="border-0 bg-transparent py-6"
        />
      </SettingsBlock>
    );
  }

  return (
    <SettingsBlock
      title="Login accounts"
      description="Create people who can sign in to TrueGage. Separate from Team & Notifications (email-only recipients)."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Share the email and temporary password with each person so they can sign in at{" "}
          <span className="font-mono text-foreground">/auth/login</span>.
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New login"}
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-surface/50 p-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="acc-name">
            <Input
              id="acc-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Work email" htmlFor="acc-email">
            <Input
              id="acc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              required
            />
          </Field>
          <Field label="Temporary password" htmlFor="acc-password">
            <Input
              id="acc-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
          </Field>
          <Field label="Role" htmlFor="acc-role">
            <select
              id="acc-role"
              className="tg-select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="member">Member</option>
              <option value="technician">Technician</option>
              <option value="qa">QA</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Department" htmlFor="acc-dept" className="sm:col-span-2">
            <Input
              id="acc-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Quality"
            />
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={() => void onCreate()} disabled={saving}>
              {saving ? "Creating…" : "Create account"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading accounts…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No login accounts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">
                      {u.full_name || "—"}
                      {u.id === meId && (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase text-primary">
                          you
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{roleDisplayLabel(u.role)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase",
                        u.active !== false
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {u.active !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                        Edit
                      </Button>
                      {u.id !== meId && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => void onToggleActive(u)}>
                            {u.active !== false ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => void onDelete(u)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit login account</DialogTitle>
            <DialogDescription>Update role, contact details, or set a new password.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <Field label="Full name" htmlFor="edit-acc-name">
                <Input
                  id="edit-acc-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </Field>
              <Field label="Email" htmlFor="edit-acc-email">
                <Input
                  id="edit-acc-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </Field>
              <Field label="Role" htmlFor="edit-acc-role">
                <select
                  id="edit-acc-role"
                  className="tg-select"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                >
                  <option value="member">Member</option>
                  <option value="technician">Technician</option>
                  <option value="qa">QA</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="New password (optional)" htmlFor="edit-acc-pw">
                <Input
                  id="edit-acc-pw"
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </Field>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="text-sm text-foreground">Active (can sign in)</span>
                <Switch checked={editActive} onCheckedChange={setEditActive} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void onSaveEdit()} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsBlock>
  );
}

function TeamMembersPanel({ onSendCheckEmail }: { onSendCheckEmail: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [orgMember, setOrgMember] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("member");
  const [editActive, setEditActive] = useState(true);
  const [editOrgMember, setEditOrgMember] = useState(true);
  const [editSaving, setEditSaving] = useState(false);

  const refresh = async () => {
    try {
      const data = await listTeamMembers();
      setMembers(data.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load team members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const openEdit = (member: TeamMember) => {
    setEditing(member);
    setEditName(member.name);
    setEditEmail(member.email);
    setEditRole(member.role);
    setEditActive(member.active);
    setEditOrgMember(member.org_member !== false);
  };

  const onAdd = async () => {
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    setSaving(true);
    try {
      await createTeamMember({
        email: email.trim(),
        name: name.trim(),
        role,
        active: true,
        org_member: orgMember,
      });
      setName("");
      setEmail("");
      setRole("member");
      setOrgMember(true);
      setShowForm(false);
      toast.success("Team member added — they will receive notification emails");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add team member");
    } finally {
      setSaving(false);
    }
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    if (!editEmail.trim()) {
      toast.error("Email is required");
      return;
    }
    setEditSaving(true);
    try {
      await updateTeamMember(editing.id, {
        name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
        active: editActive,
        org_member: editOrgMember,
      });
      toast.success("Team member updated");
      setEditing(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setEditSaving(false);
    }
  };

  const onToggleActive = async (member: TeamMember) => {
    try {
      await updateTeamMember(member.id, { active: !member.active });
      await refresh();
      toast.success(member.active ? "Notifications paused for this person" : "Notifications enabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onRemove = async (member: TeamMember) => {
    if (!window.confirm(`Remove ${member.email} from the notification team?`)) return;
    try {
      await deleteTeamMember(member.id);
      toast.success("Removed from team");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    }
  };

  return (
    <SettingsBlock
      title="Team notification recipients"
      description="People who can receive calibration emails. Mark Org member for your company contacts; leave it off for TrueGage staff or other external support emails."
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${members.length} recipient${members.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onSendCheckEmail} disabled={members.length === 0}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send check email
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Add member"}
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface/40 p-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="team-add-name">
            <Input
              id="team-add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Email" htmlFor="team-add-email">
            <Input
              id="team-add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              required
            />
          </Field>
          <Field label="Role label" htmlFor="team-add-role">
            <select
              id="team-add-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="tg-select"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="qa">QA</option>
              <option value="technician">Technician</option>
            </select>
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 sm:col-span-2">
            <div>
              <div className="text-sm font-medium text-foreground">Organization member</div>
              <div className="text-xs text-muted-foreground">
                On = your company. Off = TrueGage / external support (admins only when sending from
                Notifications).
              </div>
            </div>
            <Switch checked={orgMember} onCheckedChange={setOrgMember} />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button onClick={() => void onAdd()} disabled={saving} className="w-full sm:w-auto">
              {saving ? "Adding…" : "Add to team"}
            </Button>
          </div>
        </div>
      )}

      <div className="max-h-[50vh] overflow-x-auto rounded-lg border border-border tg-scrollbar">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Org member</th>
              <th className="px-4 py-2 font-medium">Emails</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-4">
                  <PageState
                    variant="loading"
                    title="Loading team…"
                    className="border-0 bg-transparent py-6"
                  />
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4">
                  <PageState
                    variant="empty"
                    title="No team members yet"
                    description="Add an email to include someone in calibration notification emails."
                    action={{ label: "Add member", onClick: () => setShowForm(true) }}
                    className="border-0 bg-transparent py-6"
                  />
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-foreground">{m.name || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{m.email}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{roleDisplayLabel(m.role)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase",
                        m.org_member !== false
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {m.org_member !== false ? "Org" : "TrueGage / external"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="inline-flex items-center gap-2 text-xs">
                      <Switch checked={m.active} onCheckedChange={() => void onToggleActive(m)} />
                      <span className={m.active ? "text-success" : "text-muted-foreground"}>
                        {m.active ? "On" : "Off"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(m)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void onRemove(m)}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit team member</DialogTitle>
            <DialogDescription>
              Update contact details used for calibration notification emails.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Field label="Name" htmlFor="team-edit-name">
              <Input id="team-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="team-edit-email">
              <Input
                id="team-edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </Field>
            <Field label="Role label" htmlFor="team-edit-role">
              <select
                id="team-edit-role"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="tg-select"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="qa">QA</option>
                <option value="technician">Technician</option>
              </select>
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <div className="text-sm font-medium">Organization member</div>
                <div className="text-xs text-muted-foreground">
                  Off = TrueGage / external contact (hidden from normal users when sending alerts)
                </div>
              </div>
              <Switch checked={editOrgMember} onCheckedChange={setEditOrgMember} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <div className="text-sm font-medium">Receive emails</div>
                <div className="text-xs text-muted-foreground">Include in notification sends</div>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void onSaveEdit()} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsBlock>
  );
}

function EmailDeliveryPanel({
  checkEmailOpen,
  onCheckEmailOpenChange,
}: {
  checkEmailOpen: boolean;
  onCheckEmailOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<EmailSettings | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useTls, setUseTls] = useState(true);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("TrueGage");

  const refresh = async () => {
    try {
      const s = await getEmailSettings();
      setStatus(s);
      setHost(s.smtp_host ?? "");
      setPort(String(s.smtp_port ?? 587));
      setUsername(s.smtp_username ?? "");
      setUseTls(s.smtp_use_tls);
      setFromEmail(s.smtp_from_email ?? "");
      setFromName(s.smtp_from_name ?? "TrueGage");
      setPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load email settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onSave = async () => {
    if (!host.trim() || !fromEmail.trim()) {
      toast.error("SMTP host and From email are required");
      return;
    }
    const portNum = Number(port);
    if (!Number.isFinite(portNum) || portNum < 1) {
      toast.error("Enter a valid SMTP port");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveEmailSettings({
        smtp_host: host.trim(),
        smtp_port: portNum,
        smtp_username: username.trim() || undefined,
        smtp_password: password.trim() || undefined,
        smtp_use_tls: useTls,
        smtp_from_email: fromEmail.trim(),
        smtp_from_name: fromName.trim() || "TrueGage",
      });
      setStatus(saved);
      setPassword("");
      toast.success("Email delivery settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsBlock
        title="Email Delivery"
        description="Configure the From address and SMTP server used for calibration alerts and temporary check emails."
      >
        {loading ? (
          <PageState variant="loading" title="Loading email settings…" className="border-0 bg-transparent py-8" />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {status?.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> SMTP configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                  <AlertCircle className="h-3.5 w-3.5" /> Not configured yet
                </span>
              )}
              {status?.last_error && (
                <span className="text-xs text-destructive">{status.last_error}</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="From name" htmlFor="smtp-from-name">
                <Input
                  id="smtp-from-name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="TrueGage"
                />
              </Field>
              <Field label="From email" htmlFor="smtp-from-email">
                <Input
                  id="smtp-from-email"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="alerts@yourcompany.com"
                  required
                />
              </Field>
              <Field label="SMTP host" htmlFor="smtp-host">
                <Input
                  id="smtp-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.yourprovider.com"
                  required
                />
              </Field>
              <Field label="SMTP port" htmlFor="smtp-port">
                <Input
                  id="smtp-port"
                  type="number"
                  min={1}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                />
              </Field>
              <Field label="SMTP username" htmlFor="smtp-user">
                <Input
                  id="smtp-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Usually your mailbox address"
                  autoComplete="off"
                />
              </Field>
              <Field label="SMTP password" htmlFor="smtp-pass">
                <Input
                  id="smtp-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={status?.has_password ? "Leave blank to keep current password" : "App password or SMTP secret"}
                  autoComplete="new-password"
                />
              </Field>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <div className="text-sm font-medium">Use TLS</div>
                <div className="text-xs text-muted-foreground">
                  STARTTLS on 587, or SSL on 465. Leave on for most providers.
                </div>
              </div>
              <Switch checked={useTls} onCheckedChange={setUseTls} />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => onCheckEmailOpenChange(true)} disabled={!status?.configured}>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send check email
              </Button>
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? "Saving…" : "Save email settings"}
              </Button>
            </div>
          </>
        )}
      </SettingsBlock>

      <SendCheckEmailDialog open={checkEmailOpen} onOpenChange={onCheckEmailOpenChange} />
    </div>
  );
}

function SendCheckEmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listTeamMembers()
      .then((data) => {
        const list = data.items;
        setMembers(list);
        setSelected(new Set(list.filter((m) => m.active).map((m) => m.id)));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load team"))
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllActive = () => {
    setSelected(new Set(members.filter((m) => m.active).map((m) => m.id)));
  };

  const clearAll = () => setSelected(new Set());

  const onSend = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one team member");
      return;
    }
    setSending(true);
    try {
      const result = await sendEmailCheck([...selected]);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send temporary check email</DialogTitle>
          <DialogDescription>
            Pick team members to receive a short delivery-check message. Requires Email Delivery SMTP
            settings to be saved first.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <PageState variant="loading" title="Loading team…" className="border-0 bg-transparent py-6" />
        ) : members.length === 0 ? (
          <PageState
            variant="empty"
            title="No team members yet"
            description="Add recipients under Team & Notifications first."
            className="border-0 bg-transparent py-6"
          />
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={selectAllActive}>
                Select active
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
                Clear
              </Button>
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
              {members.map((m) => {
                const checked = selected.has(m.id);
                return (
                  <li key={m.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggle(m.id, v === true)}
                        aria-label={`Select ${m.email}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">
                          {m.name || "—"}
                          {!m.active && (
                            <span className="ml-2 text-[10px] font-semibold uppercase text-muted-foreground">
                              Off
                            </span>
                          )}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">{m.email}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void onSend()} disabled={sending || members.length === 0 || selected.size === 0}>
            {sending ? "Sending…" : `Send to ${selected.size || 0}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OdooIntegrationPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OdooStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [url, setUrl] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [calDateField, setCalDateField] = useState("");
  const [calDueField, setCalDueField] = useState("");
  const [emailField, setEmailField] = useState("");

  const refresh = async () => {
    try {
      const s = await getOdooStatus();
      setStatus(s);
      setUrl(s.odoo_url ?? "");
      setDatabase(s.odoo_database ?? "");
      setUsername(s.odoo_username ?? "");
      setCalDateField(s.field_calibration_date ?? "");
      setCalDueField(s.field_calibration_due ?? "");
      setEmailField(s.field_responsible_email ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach API. Is Docker running?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onSave = async () => {
    if (!url || !database || !username || !apiKey) {
      toast.error("URL, database, username, and API key are required — click Save credentials first");
      return;
    }
    setSaving(true);
    try {
      const s = await saveOdooCredentials({
        odoo_url: url,
        odoo_database: database,
        odoo_username: username,
        odoo_api_key: apiKey,
        field_calibration_date: calDateField || undefined,
        field_calibration_due: calDueField || undefined,
        field_responsible_email:
          emailField && emailField !== "technician_user_id" ? emailField : undefined,
      });
      setStatus(s);
      setApiKey("");
      if (emailField === "technician_user_id") {
        setEmailField("");
        toast.message("Cleared responsible email mapping", {
          description: "technician_user_id is already used as the equipment owner, not an email.",
        });
      }
      toast.success("Odoo credentials saved");
      setTesting(true);
      try {
        const result = await testOdooConnection();
        await refresh();
        if (result.ok) toast.success(result.message + (result.version ? ` (v${result.version})` : ""));
        else toast.error(result.message);
      } finally {
        setTesting(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const result = await testOdooConnection();
      await refresh();
      if (result.ok) toast.success(result.message + (result.version ? ` (v${result.version})` : ""));
      else toast.error(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const result = await syncOdooEquipment();
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">ERP Integrations</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Optional: import equipment from Odoo Online into TrueGage. TrueGage stays the app of
          record for edits — nothing is written back to Odoo.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
            <Plug className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Odoo</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              One-way equipment import via API key
            </div>
            {loading ? (
              <p className="mt-2 text-xs text-muted-foreground">Loading status…</p>
            ) : status ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {status.connected ? (
                  <span className="inline-flex items-center gap-1 font-medium text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                  </span>
                ) : status.configured ? (
                  <span className="inline-flex items-center gap-1 font-medium text-warning">
                    <AlertCircle className="h-3.5 w-3.5" /> Configured · not verified
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not connected</span>
                )}
                <span className="text-muted-foreground">
                  · {status.equipment_count} equipment cached
                </span>
                {status.last_sync_at && (
                  <span className="text-muted-foreground">
                    · Last sync {new Date(status.last_sync_at).toLocaleString()}
                  </span>
                )}
              </div>
            ) : null}
            {status?.last_error && (
              <p className="mt-1 text-xs text-destructive">{status.last_error}</p>
            )}
          </div>
        </div>
      </div>

      <SettingsBlock
        title="Odoo credentials"
        description="Optional. Stored encrypted on the server. Import adds new equipment only — existing TrueGage records are never overwritten or deleted."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Odoo URL">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourcompany.odoo.com"
              />
            </Field>
          </div>
          <Field label="Database name">
            <Input
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="yourcompany"
            />
          </Field>
          <Field label="Username (email)">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin@yourcompany.com"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="API key">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={status?.configured ? "Enter new key to replace existing" : "Odoo API key"}
                autoComplete="off"
              />
            </Field>
          </div>
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Map Odoo Studio field technical names for calibration dates. Defaults match this
            workspace:{" "}
            <span className="font-mono text-foreground">x_studio_equipment_last_calibration_date</span>{" "}
            /{" "}
            <span className="font-mono text-foreground">x_studio_next_calibration_due_date</span>.
            Re-import refreshes dates on existing Odoo equipment.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Calibration date field" htmlFor="odoo-cal-date">
              <Input
                id="odoo-cal-date"
                value={calDateField}
                onChange={(e) => setCalDateField(e.target.value)}
                placeholder="x_studio_equipment_last_calibration_date"
              />
            </Field>
            <Field label="Calibration due field" htmlFor="odoo-cal-due">
              <Input
                id="odoo-cal-due"
                value={calDueField}
                onChange={(e) => setCalDueField(e.target.value)}
                placeholder="x_studio_next_calibration_due_date"
              />
            </Field>
            <Field label="Responsible email field" htmlFor="odoo-email">
              <Input
                id="odoo-email"
                value={emailField}
                onChange={(e) => setEmailField(e.target.value)}
                placeholder="x_responsible_email"
              />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button onClick={() => void onSave()} disabled={saving || testing}>
            {saving ? "Saving…" : testing ? "Testing…" : "Save & test connection"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void onTest()}
            disabled={testing || saving || !status?.configured}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void onSync()}
            disabled={syncing || !status?.configured}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Importing…" : "Import from Odoo"}
          </Button>
        </div>
      </SettingsBlock>
    </div>
  );
}

function SettingsBlock({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
