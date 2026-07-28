import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  getOrgTaxonomy,
  saveOrgTaxonomyApi,
  importOrgTaxonomyFromEquipment,
  getReminderRules,
  saveReminderRules,
  getReminderLogs,
  getMe,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  revokeUserSessions,
  sendUserCredentials,
  type OdooStatus,
  type TeamMember,
  type EmailSettings,
  type AuthUser,
  type OrgUserRole,
  type OrgTaxonomyApi,
  type ReminderRulesApi,
  type ReminderLogApi,
} from "@/lib/api";
import {
  defaultOrgProfile,
  roleDisplayLabel,
  type OrgProfile,
} from "@/lib/compliance";
import {
  PERMISSION_ROWS,
  ROLE_META,
  WORKSPACE_ROLES,
  roleBlurb,
  type WorkspaceRole,
} from "@/lib/roles";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { PageState } from "@/components/tg/page-state";

const sections = [
  { id: "company", label: "Organization Profile", icon: Building2 },
  { id: "accounts", label: "People & access", icon: KeyRound },
  { id: "users", label: "Notification recipients", icon: Users },
  { id: "email", label: "Email Delivery", icon: Mail },
  { id: "taxonomy", label: "Department Registers", icon: Layers },
  { id: "notifications", label: "Alarm & Reminder Rules", icon: BellRing },
  { id: "integrations", label: "ERP Integrations", icon: Plug },
] as const;

type SettingsSection = (typeof sections)[number]["id"];

const SECTION_IDS = new Set<string>(sections.map((s) => s.id));

export const Route = createFileRoute("/workspace/$slug/settings")({
  head: () => ({ meta: [{ title: "Settings · TrueGage" }] }),
  validateSearch: (search: Record<string, unknown>): { section?: SettingsSection } => {
    if (typeof search.section === "string" && SECTION_IDS.has(search.section)) {
      return { section: search.section as SettingsSection };
    }
    return {};
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [active, setActive] = useState<SettingsSection>(search.section ?? "company");
  const [org, setOrg] = useState<OrgProfile>(defaultOrgProfile);
  const [ownerName, setOwnerName] = useState("Administrator");
  const [checkEmailOpen, setCheckEmailOpen] = useState(false);
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");

  useEffect(() => {
    if (search.section) setActive(search.section);
  }, [search.section]);

  const selectSection = (id: SettingsSection) => {
    setActive(id);
    void navigate({
      to: "/workspace/$slug/settings",
      params: { slug },
      search: id === "company" ? {} : { section: id },
      replace: true,
    });
  };

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
    selectSection("email");
    setCheckEmailOpen(true);
  };

  return (
    <AppShell breadcrumbs={[{ label: "Settings" }]} hidePageHeader autoCollapseSidebar>
      {access === "loading" && (
        <PageState variant="loading" title="Checking access…" className="border-0 bg-transparent" />
      )}
      {access === "denied" && (
        <PageState
          variant="empty"
          title="Admin access required"
          description="Only workspace admins can open Settings. Ask an admin if you need changes."
          action={{ label: "Back to dashboard", onClick: () => void navigate({ to: "/workspace/$slug", params: { slug } }) }}
          className="border-0 bg-transparent"
        />
      )}
      {access === "allowed" && (
        <>
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
          <Link to="/workspace/$slug/profile" params={{ slug }} className="text-primary hover:underline">
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
                  onClick={() => selectSection(s.id)}
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

          {active === "accounts" && <PeopleAccessPanel />}

          {active === "users" && <TeamMembersPanel onSendCheckEmail={openCheckEmail} />}

          {active === "email" && (
            <EmailDeliveryPanel
              checkEmailOpen={checkEmailOpen}
              onCheckEmailOpenChange={setCheckEmailOpen}
            />
          )}

          {active === "taxonomy" && <TaxonomyRegistersPanel />}

          {active === "notifications" && <ReminderRulesPanel openCheckEmail={openCheckEmail} selectSection={selectSection} />}

          {active === "integrations" && <OdooIntegrationPanel />}
        </div>
      </div>
        </>
      )}
    </AppShell>
  );
}

function ReminderRulesPanel({
  openCheckEmail,
  selectSection,
}: {
  openCheckEmail: () => void;
  selectSection: (id: SettingsSection) => void;
}) {
  const defaults: ReminderRulesApi = {
    remind_30d: false,
    remind_14d: false,
    remind_7d: false,
    remind_1d: false,
    remind_overdue_daily: false,
    remind_weekly_digest: false,
    reminder_hour_local: 8,
    last_daily_run_at: null,
  };
  const [rules, setRules] = useState<ReminderRulesApi>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<ReminderLogApi | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logFilters, setLogFilters] = useState({
    q: "",
    channel: "",
    kind: "",
    status: "",
    from_date: "",
    to_date: "",
  });

  const loadLogs = async (filters = logFilters) => {
    setLogsLoading(true);
    try {
      setLogs(
        await getReminderLogs(100, {
          q: filters.q || undefined,
          channel: filters.channel || undefined,
          kind: filters.kind || undefined,
          status: filters.status || undefined,
          from_date: filters.from_date || undefined,
          to_date: filters.to_date || undefined,
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load reminder logs");
    } finally {
      setLogsLoading(false);
    }
  };

  const hasActiveFilters = Boolean(
    logFilters.q.trim() ||
      logFilters.channel ||
      logFilters.kind ||
      logFilters.status ||
      logFilters.from_date ||
      logFilters.to_date,
  );

  const clearLogFilters = () => {
    const empty = { q: "", channel: "", kind: "", status: "", from_date: "", to_date: "" };
    setLogFilters(empty);
    void loadLogs(empty);
  };

  useEffect(() => {
    void getReminderRules()
      .then(setRules)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load reminder rules"))
      .finally(() => setLoading(false));
    void loadLogs();
  }, []);

  const setFlag = (
    key:
      | "remind_30d"
      | "remind_14d"
      | "remind_7d"
      | "remind_1d"
      | "remind_overdue_daily"
      | "remind_weekly_digest",
    value: boolean,
  ) => {
    setRules((r) => ({ ...r, [key]: value }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const saved = await saveReminderRules({
        remind_30d: rules.remind_30d,
        remind_14d: rules.remind_14d,
        remind_7d: rules.remind_7d,
        remind_1d: rules.remind_1d,
        remind_overdue_daily: rules.remind_overdue_daily,
        remind_weekly_digest: rules.remind_weekly_digest,
        reminder_hour_local: rules.reminder_hour_local,
      });
      setRules(saved);
      toast.success("Reminder rules saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save reminder rules");
    } finally {
      setSaving(false);
    }
  };

  const toggles: Array<{
    key:
      | "remind_30d"
      | "remind_14d"
      | "remind_7d"
      | "remind_1d"
      | "remind_overdue_daily"
      | "remind_weekly_digest";
    label: string;
    hint: string;
  }> = [
    { key: "remind_30d", label: "30 days before due", hint: "Email + in-app" },
    { key: "remind_14d", label: "14 days before due", hint: "Email + in-app" },
    { key: "remind_7d", label: "7 days before due", hint: "Email + in-app" },
    { key: "remind_1d", label: "1 day before due / due today", hint: "Email + in-app" },
    { key: "remind_overdue_daily", label: "Overdue (daily)", hint: "Email + in-app" },
    { key: "remind_weekly_digest", label: "Weekly digest", hint: "Monday summary · Email + in-app" },
  ];

  const statusClass = (status: string) => {
    if (status === "done" || status === "sent") return "text-emerald-700 bg-emerald-500/10";
    if (status === "failed") return "text-red-700 bg-red-500/10";
    if (status === "partial") return "text-orange-800 bg-orange-500/10";
    if (status === "running" || status === "pending") return "text-amber-800 bg-amber-500/10";
    return "text-muted-foreground bg-muted";
  };

  const fmtWhen = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  };

  return (
    <div className="space-y-6">
    <SettingsBlock
      title="Alarm & Reminder Rules"
      description="Workspace reminders run once per day at 08:00 in the organization timezone. Emails use SMTP under Email Delivery."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface/40 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Outbound mail is configured in{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => selectSection("email")}
          >
            Email Delivery
          </button>
          .
          {rules.last_daily_run_at ? (
            <span className="mt-1 block text-xs">
              Last daily run: {new Date(rules.last_daily_run_at).toLocaleString()}
            </span>
          ) : null}
        </p>
        <Button size="sm" variant="outline" onClick={openCheckEmail}>
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Send check email
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading reminder rules…</p>
      ) : (
        <>
          <div className="space-y-3">
            {toggles.map(({ key, label, hint }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{hint}</div>
                </div>
                <Switch
                  checked={Boolean(rules[key])}
                  onCheckedChange={(v) => setFlag(key, v)}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? "Saving…" : "Save reminder rules"}
            </Button>
          </div>
        </>
      )}
    </SettingsBlock>

    <SettingsBlock
      title="Reminder engine log"
      description="Admin-only history of scheduled runs and delivery attempts for this workspace."
    >
      <div className="mb-4 space-y-3 rounded-lg border border-border bg-surface/40 p-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="sm:col-span-2 xl:col-span-1">
            <Label htmlFor="reminder-log-q" className="mb-1.5 block text-xs text-muted-foreground">
              Search
            </Label>
            <Input
              id="reminder-log-q"
              value={logFilters.q}
              onChange={(e) => setLogFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Name, email, or subject…"
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadLogs();
              }}
            />
          </div>
          <div>
            <Label htmlFor="reminder-log-kind" className="mb-1.5 block text-xs text-muted-foreground">
              Reminder type
            </Label>
            <select
              id="reminder-log-kind"
              className="tg-select"
              value={logFilters.kind}
              onChange={(e) => setLogFilters((f) => ({ ...f, kind: e.target.value }))}
            >
              <option value="">All types</option>
              <option value="overdue_daily">Overdue daily</option>
              <option value="due_30">30 days before</option>
              <option value="due_14">14 days before</option>
              <option value="due_7">7 days before</option>
              <option value="due_1">1 day / due today</option>
              <option value="weekly_digest">Weekly digest</option>
            </select>
          </div>
          <div>
            <Label htmlFor="reminder-log-channel" className="mb-1.5 block text-xs text-muted-foreground">
              Channel
            </Label>
            <select
              id="reminder-log-channel"
              className="tg-select"
              value={logFilters.channel}
              onChange={(e) => setLogFilters((f) => ({ ...f, channel: e.target.value }))}
            >
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="in_app">In-app</option>
            </select>
          </div>
          <div>
            <Label htmlFor="reminder-log-status" className="mb-1.5 block text-xs text-muted-foreground">
              Status
            </Label>
            <select
              id="reminder-log-status"
              className="tg-select"
              value={logFilters.status}
              onChange={(e) => setLogFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">All statuses</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <Label htmlFor="reminder-log-from" className="mb-1.5 block text-xs text-muted-foreground">
              From date
            </Label>
            <Input
              id="reminder-log-from"
              type="date"
              value={logFilters.from_date}
              onChange={(e) => setLogFilters((f) => ({ ...f, from_date: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="reminder-log-to" className="mb-1.5 block text-xs text-muted-foreground">
              To date
            </Label>
            <Input
              id="reminder-log-to"
              type="date"
              value={logFilters.to_date}
              onChange={(e) => setLogFilters((f) => ({ ...f, to_date: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hasActiveFilters ? (
            <Button size="sm" variant="ghost" onClick={clearLogFilters}>
              Clear filters
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void loadLogs()} disabled={logsLoading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", logsLoading && "animate-spin")} />
            {logsLoading ? "Searching…" : "Apply / Refresh"}
          </Button>
        </div>
      </div>
      {logsLoading && !logs ? (
        <p className="text-sm text-muted-foreground">Loading reminder logs…</p>
        ) : !logs || (logs.jobs.length === 0 && logs.sends.length === 0 && !hasActiveFilters) ? (
          <p className="text-sm text-muted-foreground">
            No reminder runs yet. The worker creates entries after the daily 08:00 window (org timezone).
          </p>
        ) : logs.sends.length === 0 && hasActiveFilters ? (
          <p className="text-sm text-muted-foreground">
            No sends match these filters. Try clearing search or widening the date range.
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Jobs ({logs.jobs_total})
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-border bg-surface/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Kind</th>
                      <th className="px-3 py-2 font-medium">Local date</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Attempts</th>
                      <th className="px-3 py-2 font-medium">Finished</th>
                      <th className="px-3 py-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {logs.jobs.map((j) => (
                      <tr key={j.id}>
                        <td className="px-3 py-2 font-mono text-xs">{j.job_kind}</td>
                        <td className="px-3 py-2 font-mono text-xs">{j.job_date_local}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase",
                              statusClass(j.status),
                            )}
                          >
                            {j.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{j.attempts}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{fmtWhen(j.finished_at)}</td>
                        <td
                          className="max-w-[220px] truncate px-3 py-2 text-xs text-red-700"
                          title={j.error ?? undefined}
                        >
                          {j.error || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sends ({logs.sends_total})
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-border bg-surface/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Subject</th>
                      <th className="px-3 py-2 font-medium">Channel</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Recipient</th>
                      <th className="px-3 py-2 font-medium">Items</th>
                      <th className="px-3 py-2 font-medium">Sent</th>
                      <th className="px-3 py-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {logs.sends.map((s, idx) => (
                      <tr key={`${s.kind}-${s.channel}-${s.recipient_key}-${s.sent_at ?? idx}`}>
                        <td className="max-w-[280px] px-3 py-2 text-xs font-medium text-foreground" title={s.subject}>
                          {s.subject}
                        </td>
                        <td className="px-3 py-2 text-xs">{s.channel}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase",
                              statusClass(s.status),
                            )}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="max-w-[200px] px-3 py-2 text-xs">
                          <div
                            className="truncate font-medium text-foreground"
                            title={s.recipient_name || s.recipient_key}
                          >
                            {s.recipient_name || s.recipient_key}
                          </div>
                          {s.recipient_email ? (
                            <div
                              className="truncate font-mono text-[11px] text-muted-foreground"
                              title={s.recipient_email}
                            >
                              {s.recipient_email}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-xs">{s.equipment_count}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{fmtWhen(s.sent_at)}</td>
                        <td
                          className="max-w-[180px] truncate px-3 py-2 text-xs text-red-700"
                          title={s.error ?? undefined}
                        >
                          {s.error || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
    </SettingsBlock>
    </div>
  );
}

function genTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let out = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out}Aa1!`;
}

function TaxonomyRegistersPanel() {
  const empty: OrgTaxonomyApi = { departments: [], categories: [], locations: [] };
  const [taxonomy, setTaxonomy] = useState<OrgTaxonomyApi>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState({ departments: "", categories: "", locations: "" });

  const load = async () => {
    try {
      const data = await getOrgTaxonomy();
      setTaxonomy(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load registers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const persist = async (next: OrgTaxonomyApi) => {
    setSaving(true);
    try {
      const saved = await saveOrgTaxonomyApi(next);
      setTaxonomy(saved);
      toast.success("Registers saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const addTerm = (key: keyof OrgTaxonomyApi) => {
    const value = drafts[key].trim();
    if (!value) {
      toast.error("Enter a name to add");
      return;
    }
    const exists = taxonomy[key].some((t) => t.toLowerCase() === value.toLowerCase());
    if (exists) {
      toast.error("Already in the list");
      return;
    }
    setDrafts((d) => ({ ...d, [key]: "" }));
    void persist({ ...taxonomy, [key]: [...taxonomy[key], value] });
  };

  const removeTerm = (key: keyof OrgTaxonomyApi, term: string) => {
    void persist({
      ...taxonomy,
      [key]: taxonomy[key].filter((t) => t !== term),
    });
  };

  const onImport = async () => {
    setSaving(true);
    try {
      const merged = await importOrgTaxonomyFromEquipment();
      setTaxonomy(merged);
      toast.success("Imported values from existing equipment");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading registers…</p>;
  }

  const columns: Array<{ key: keyof OrgTaxonomyApi; title: string; hint: string }> = [
    { key: "departments", title: "Departments", hint: "Used on equipment and user profiles" },
    { key: "categories", title: "Categories", hint: "Equipment type / gauge family" },
    { key: "locations", title: "Locations", hint: "Where equipment is kept or used" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Department Registers</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage the lists used in equipment forms and people records. Changes save immediately.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void onImport()} disabled={saving}>
          Import from equipment
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {columns.map(({ key, title, hint }) => (
          <div key={key} className="rounded-xl border border-border bg-card shadow-xs">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
            </div>
            <div className="flex gap-2 border-b border-border px-3 py-2">
              <Input
                value={drafts[key]}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={`Add ${title.slice(0, -1).toLowerCase()}…`}
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTerm(key);
                  }
                }}
                disabled={saving}
              />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => addTerm(key)}
                disabled={saving}
              >
                + Add
              </Button>
            </div>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">
              {taxonomy[key].length === 0 ? (
                <li className="px-4 py-6 text-center text-muted-foreground">
                  No {title.toLowerCase()} yet.
                </li>
              ) : (
                taxonomy[key].map((term) => (
                  <li
                    key={term}
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <span className="min-w-0 truncate text-foreground">{term}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => removeTerm(key, term)}
                      disabled={saving}
                    >
                      Remove
                    </Button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeopleAccessPanel() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [meId, setMeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [smtpReady, setSmtpReady] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | WorkspaceRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<OrgUserRole>("member");
  const [department, setDepartment] = useState("");
  const [sendCredentials, setSendCredentials] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<OrgUserRole>("member");
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const refresh = async () => {
    try {
      const [list, me, emailCfg, taxonomy] = await Promise.all([
        listUsers(),
        getMe(),
        getEmailSettings().catch(() => null),
        getOrgTaxonomy().catch(() => null),
      ]);
      setUsers(list.items);
      setMeId(me.id);
      setSmtpReady(Boolean(emailCfg?.configured));
      setDepartments(taxonomy?.departments ?? []);
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

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      const active = u.active !== false;
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "inactive" && active) return false;
      if (!term) return true;
      return (
        u.email.toLowerCase().includes(term) ||
        (u.full_name || "").toLowerCase().includes(term) ||
        (u.department || "").toLowerCase().includes(term)
      );
    });
  }, [users, q, roleFilter, statusFilter]);

  const openCreate = () => {
    setPassword(genTempPassword());
    setSendCredentials(smtpReady);
    setCreateOpen(true);
  };

  const onCreate = async () => {
    if (!email.trim() || !password.trim()) {
      toast.error("Email and password are required");
      return;
    }
    if (password.length < 12) {
      toast.error("Password must be at least 12 characters");
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
        send_credentials: sendCredentials,
      });
      toast.success(
        sendCredentials
          ? "Account created — login details emailed"
          : "Account created — share the temporary password securely",
      );
      setCreateOpen(false);
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
    setEditRole((u.role === "platform_admin" ? "admin" : u.role) as OrgUserRole);
    setEditActive(u.active !== false);
    setEditPassword("");
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    if (editPassword.trim() && editPassword.trim().length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }
    setEditSaving(true);
    try {
      await updateUser(editing.id, {
        full_name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
        active: editActive,
        ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      });
      toast.success("Access updated");
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

  const onRevoke = async (u: AuthUser) => {
    if (!confirm(`Revoke all signed-in sessions for ${u.email}?`)) return;
    try {
      await revokeUserSessions(u.id);
      toast.success("Sessions revoked");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke sessions");
    }
  };

  const onEmailCredentials = async (u: AuthUser) => {
    if (!smtpReady) {
      toast.error("Configure Email Delivery (SMTP) first");
      return;
    }
    const pw = genTempPassword();
    if (
      !confirm(
        `Reset password for ${u.email} and email the new temporary password? Their current sessions will be revoked.`,
      )
    ) {
      return;
    }
    try {
      await sendUserCredentials(u.id, pw);
      toast.success("Credentials emailed");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send credentials");
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

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Password copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  if (forbidden) {
    return (
      <SettingsBlock
        title="People & access"
        description="Only admins can manage who can sign in and what each role can do."
      >
        <PageState
          variant="empty"
          title="Admin access required"
          description="Ask a workspace admin to grant you the Admin role."
          className="border-0 bg-transparent py-6"
        />
      </SettingsBlock>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsBlock
        title="People & access"
        description="Manage who can sign in to this workspace and which role they have. Notification recipients (email-only) are managed separately."
      >
        <div className="mb-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Capability</th>
                {WORKSPACE_ROLES.map((r) => (
                  <th key={r} className="px-3 py-2 text-center">
                    {ROLE_META[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map((row) => (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-foreground">{row.label}</td>
                  {WORKSPACE_ROLES.map((r) => (
                    <td key={r} className="px-3 py-2 text-center">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                          row[r]
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {row[r] ? "Yes" : "—"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          QA and Technician share the same write access. Only Admins can change people, settings, and
          integrations.
        </p>
      </SettingsBlock>

      <SettingsBlock
        title="Login users"
        description="People with TrueGage accounts. Share credentials securely or email them when SMTP is configured."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <select
            className="tg-select max-w-[140px]"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          >
            <option value="all">All roles</option>
            {WORKSPACE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </select>
          <select
            className="tg-select max-w-[140px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="flex-1" />
          <Button size="sm" onClick={openCreate}>
            + Add person
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading people…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users match these filters.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
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
                      {u.department ? (
                        <div className="text-[11px] text-muted-foreground">{u.department}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{roleDisplayLabel(u.role)}</div>
                      <div className="max-w-[180px] text-[11px] text-muted-foreground">
                        {roleBlurb(u.role)}
                      </div>
                    </td>
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
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {u.updated_at ? new Date(u.updated_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                          Manage
                        </Button>
                        {u.id !== meId && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => void onRevoke(u)}>
                              Revoke sessions
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void onEmailCredentials(u)}
                              disabled={!smtpReady}
                              title={
                                smtpReady
                                  ? "Reset password and email credentials"
                                  : "Configure SMTP in Email Delivery"
                              }
                            >
                              Email credentials
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void onToggleActive(u)}>
                              {u.active !== false ? "Disable" : "Enable"}
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
      </SettingsBlock>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>
              Creates a login for this workspace. Minimum password length is 6 characters.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
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
            <Field label="Temporary password" htmlFor="acc-password" className="sm:col-span-2">
              <div className="flex gap-2">
                <Input
                  id="acc-password"
                  className="font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                />
                <Button type="button" variant="outline" onClick={() => setPassword(genTempPassword())}>
                  Generate
                </Button>
                <Button type="button" variant="outline" onClick={() => void copyPassword()}>
                  Copy
                </Button>
              </div>
            </Field>
            <Field label="Role" htmlFor="acc-role" className="sm:col-span-2">
              <select
                id="acc-role"
                className="tg-select"
                value={role}
                onChange={(e) => setRole(e.target.value as OrgUserRole)}
              >
                {WORKSPACE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label} — {ROLE_META[r].short}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{ROLE_META[role].blurb}</p>
            </Field>
            <Field label="Department" htmlFor="acc-dept" className="sm:col-span-2">
              <select
                id="acc-dept"
                className="tg-select"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                {department && !departments.includes(department) ? (
                  <option value={department}>{department}</option>
                ) : null}
              </select>
              {departments.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Add departments under Settings → Department Registers.
                </p>
              )}
            </Field>
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={sendCredentials}
                onCheckedChange={(v) => setSendCredentials(v === true)}
                disabled={!smtpReady}
              />
              <span>
                Email login details now
                {!smtpReady && (
                  <span className="block text-xs">
                    Requires SMTP under{" "}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => {
                        setCreateOpen(false);
                        /* parent can't set active easily — leave hint */
                      }}
                    >
                      Email Delivery
                    </button>
                    .
                  </span>
                )}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={saving}>
              {saving ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage access</DialogTitle>
            <DialogDescription>
              Update role, contact details, or set a new password (min 12 characters).
            </DialogDescription>
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
                  onChange={(e) => setEditRole(e.target.value as OrgUserRole)}
                >
                  {WORKSPACE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_META[r].label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">{ROLE_META[editRole].blurb}</p>
              </Field>
              <Field label="New password (optional)" htmlFor="edit-acc-pw">
                <Input
                  id="edit-acc-pw"
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current (min 12 if set)"
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
    </div>
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
      title="Notification recipients"
      description="Email-only contacts for calibration alerts. These people do not get a TrueGage login — manage sign-in access under People & access."
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
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
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
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
