import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/tg/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getMe,
  getOrgTaxonomy,
  resetProductTour,
  updateMe,
  updateMyPreferences,
  type AuthUser,
  type EffectiveSettings,
} from "@/lib/api";
import { roleDisplayLabel, userInitials, type UserProfile } from "@/lib/compliance";
import { needsOnboarding } from "@/lib/rbac";
import { toast } from "sonner";
import { Check, Eye, EyeOff, Info, Lock, MapPin, Shield } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  DEFAULT_EFFECTIVE,
  formatHourLabel,
  timezoneDisplayLabel,
  timezoneShortLabel,
} from "@/lib/format-settings";
import { TimezoneCombobox } from "@/components/tg/timezone-combobox";
import {
  PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN,
  PASSWORD_POLICY_HINT,
  isPasswordValid,
  passwordChecks,
  passwordPolicyError,
} from "@/lib/password-policy";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workspace/$slug/profile")({
  head: () => ({ meta: [{ title: "Profile · TrueGage" }] }),
  component: ProfilePage,
});

type PrefSnapshot = {
  tzOverride: string;
  dateOverride: string;
  timeOverride: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
};

function fromApi(u: AuthUser): UserProfile {
  return {
    fullName: u.full_name,
    email: u.email,
    jobTitle: u.job_title,
    department: u.department,
    phone: u.phone,
    role: u.role,
    timezone: u.timezone,
    locale: u.locale,
    notifyEmail: u.notify_email,
    notifyInApp: u.notify_in_app,
  };
}

function prefsFromUser(u: AuthUser, profile: UserProfile): PrefSnapshot {
  return {
    tzOverride: u.timezone_override || "",
    dateOverride: u.date_format_override || "",
    timeOverride: u.time_format_override || "",
    notifyEmail: profile.notifyEmail,
    notifyInApp: profile.notifyInApp,
  };
}

function ProfilePage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null);
  const [effective, setEffective] = useState<EffectiveSettings>(DEFAULT_EFFECTIVE);
  const [tzOverride, setTzOverride] = useState<string>("");
  const [dateOverride, setDateOverride] = useState<string>("");
  const [timeOverride, setTimeOverride] = useState<string>("");
  const [savedPrefs, setSavedPrefs] = useState<PrefSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [replayingTour, setReplayingTour] = useState(false);

  const applyMe = (u: AuthUser) => {
    const next = fromApi(u);
    setProfile(next);
    setSavedProfile(next);
    const eff = u.effective_settings
      ? { ...DEFAULT_EFFECTIVE, ...u.effective_settings }
      : DEFAULT_EFFECTIVE;
    setEffective(eff);
    const tz = u.timezone_override || "";
    const date = u.date_format_override || "";
    const time = u.time_format_override || "";
    setTzOverride(tz);
    setDateOverride(date);
    setTimeOverride(time);
    setSavedPrefs(prefsFromUser(u, next));
  };

  useEffect(() => {
    void getMe()
      .then(applyMe)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load profile"))
      .finally(() => setLoading(false));
    void getOrgTaxonomy()
      .then((t) => setDepartments(t.departments))
      .catch(() => setDepartments([]));
  }, []);

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  };

  const dirty = useMemo(() => {
    if (!profile || !savedProfile || !savedPrefs) return false;
    const accountDirty =
      profile.fullName !== savedProfile.fullName ||
      profile.email !== savedProfile.email ||
      profile.jobTitle !== savedProfile.jobTitle ||
      profile.department !== savedProfile.department;
    const prefsDirty =
      tzOverride !== savedPrefs.tzOverride ||
      dateOverride !== savedPrefs.dateOverride ||
      timeOverride !== savedPrefs.timeOverride ||
      profile.notifyEmail !== savedPrefs.notifyEmail ||
      profile.notifyInApp !== savedPrefs.notifyInApp;
    return accountDirty || prefsDirty;
  }, [profile, savedProfile, savedPrefs, tzOverride, dateOverride, timeOverride]);

  const onSave = async () => {
    if (!profile) return;
    if (!profile.fullName.trim()) {
      toast.error("Full name is required");
      return;
    }
    if (!profile.email.trim() || !profile.email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateMe({
        full_name: profile.fullName.trim(),
        email: profile.email.trim().toLowerCase(),
        job_title: profile.jobTitle.trim(),
        department: profile.department.trim(),
      });
      let next = updated;
      try {
        const prefPayload: Parameters<typeof updateMyPreferences>[0] = {};
        if (effective.allow_user_display_override) {
          if (!tzOverride) prefPayload.clear_timezone_override = true;
          else prefPayload.timezone_override = tzOverride;
          if (!dateOverride) prefPayload.clear_date_format_override = true;
          else prefPayload.date_format_override = dateOverride;
          if (!timeOverride) prefPayload.clear_time_format_override = true;
          else prefPayload.time_format_override = timeOverride;
        }
        if (effective.allow_user_channel_toggle) {
          prefPayload.notify_email = profile.notifyEmail;
          prefPayload.notify_in_app = profile.notifyInApp;
        }
        if (Object.keys(prefPayload).length > 0) {
          next = await updateMyPreferences(prefPayload);
        }
      } catch (prefErr) {
        toast.error(prefErr instanceof Error ? prefErr.message : "Could not save preferences");
      }
      applyMe(next);
      window.dispatchEvent(new CustomEvent("tg-user-profile-updated", { detail: next }));
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onChangePassword = async () => {
    if (!currentPassword) {
      toast.error("Enter your current password");
      return;
    }
    const policyErr = passwordPolicyError(newPassword);
    if (policyErr) {
      toast.error(policyErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match");
      return;
    }
    setChangingPassword(true);
    try {
      await updateMe({
        current_password: currentPassword,
        password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated — use it next time you sign in");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading || !profile) {
    return (
      <AppShell breadcrumbs={[{ label: "Profile" }]} hidePageHeader>
        <ProfileSkeleton />
      </AppShell>
    );
  }

  const initials = userInitials(profile);
  const allowDisplay = effective.allow_user_display_override;
  const allowChannel = effective.allow_user_channel_toggle;
  const prefsLocked = !allowDisplay && !allowChannel;
  const hourLabel = formatHourLabel(effective.reminder_send_hour, effective.time_format);
  const displayName = profile.fullName.trim() || profile.email.trim() || "Your profile";
  const metaBits = [
    profile.department.trim() || null,
    profile.jobTitle.trim() || null,
  ].filter(Boolean);
  const pwCheck = passwordChecks(newPassword);
  const pwMatches = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmitPassword =
    !!currentPassword && isPasswordValid(newPassword) && pwMatches && !changingPassword;

  return (
    <AppShell breadcrumbs={[{ label: "Profile" }]} hidePageHeader>
      <div className="relative pb-24">
        {/* Identity header */}
        <div className="mb-6 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="border-b border-border bg-linear-to-br from-primary/8 via-transparent to-transparent px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-wrap items-center gap-4 sm:gap-5">
              <div className="grid h-18 w-18 shrink-0 place-items-center rounded-2xl bg-primary/15 text-xl font-semibold tracking-tight text-primary sm:h-20 sm:w-20 sm:text-2xl">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                    {displayName}
                  </h1>
                  <span className="inline-flex items-center rounded-md border border-border bg-background/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {roleDisplayLabel(profile.role)}
                  </span>
                </div>
                {metaBits.length > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{metaBits.join(" · ")}</p>
                ) : null}
                {profile.email ? (
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{profile.email}</p>
                ) : null}
                <p className="mt-2 max-w-xl text-xs text-muted-foreground">
                  Your workspace identity — shown in the sidebar and used for reminders and audit
                  activity.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Section
            title="Account"
            description="Name and contact details for this workspace."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="profile-full-name" className="sm:col-span-2">
                <Input
                  id="profile-full-name"
                  value={profile.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder="Sarah Jenkins"
                />
              </Field>
              <Field label="Work email" htmlFor="profile-email" className="sm:col-span-2">
                <Input
                  id="profile-email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@company.com"
                />
              </Field>
              <Field label="Job title" htmlFor="profile-job-title">
                <Input
                  id="profile-job-title"
                  value={profile.jobTitle}
                  onChange={(e) => set("jobTitle", e.target.value)}
                  placeholder="Quality Manager"
                />
              </Field>
              <Field label="Department" htmlFor="profile-department">
                <select
                  id="profile-department"
                  className="tg-select"
                  value={profile.department}
                  onChange={(e) => set("department", e.target.value)}
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {profile.department && !departments.includes(profile.department) ? (
                    <option value={profile.department}>{profile.department}</option>
                  ) : null}
                </select>
              </Field>
              <Field label="Role" htmlFor="profile-role" className="sm:col-span-2">
                <Input
                  id="profile-role"
                  value={roleDisplayLabel(profile.role)}
                  disabled
                  readOnly
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Assigned by your workspace admin — not editable here.
                </p>
              </Field>
            </div>
          </Section>

          <Section
            title="Security"
            description="Change the password you use to sign in."
            icon={<Shield className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid gap-3">
              <Field label="Current password" htmlFor="profile-current-pw">
                <PasswordInput
                  id="profile-current-pw"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                  placeholder="Temporary password from your invite email"
                />
              </Field>
              <Field label="New password" htmlFor="profile-new-pw">
                <PasswordInput
                  id="profile-new-pw"
                  value={newPassword}
                  onChange={(v) => setNewPassword(v.slice(0, PASSWORD_MAX_LEN))}
                  autoComplete="new-password"
                  placeholder={PASSWORD_POLICY_HINT}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="profile-confirm-pw">
                <PasswordInput
                  id="profile-confirm-pw"
                  value={confirmPassword}
                  onChange={(v) => setConfirmPassword(v.slice(0, PASSWORD_MAX_LEN))}
                  autoComplete="new-password"
                />
              </Field>

              <ul className="space-y-1.5 rounded-lg border border-border bg-surface/40 px-3 py-2.5 text-xs">
                <PwCheck
                  ok={pwCheck.lengthOk}
                  label={`${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} characters`}
                />
                <PwCheck ok={pwCheck.hasSpecial} label="At least one special character" />
                <PwCheck ok={pwMatches} label="New password and confirmation match" />
              </ul>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  onClick={() => void onChangePassword()}
                  disabled={!canSubmitPassword}
                >
                  {changingPassword ? "Updating…" : "Update password"}
                </Button>
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Sign out from the sidebar when finished on a shared machine.
              </div>
            </div>
          </Section>
        </div>

        <div className="mt-4 space-y-4">
          <Section
            title="Preferences"
            description="How dates appear and how you receive calibration reminders."
            icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
          >
            {prefsLocked ? (
              <div className="mb-4 flex gap-2 rounded-lg border border-border bg-surface/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  Display formats and reminder channels follow your organization&apos;s{" "}
                  <span className="font-medium text-foreground">Regional &amp; notifications</span>{" "}
                  settings. Ask an admin if you need a personal override.
                </p>
              </div>
            ) : null}

            <p className="mb-4 text-xs text-muted-foreground">
              Reminder emails go out daily at {hourLabel}{" "}
              {timezoneShortLabel(effective.timezone)}
              {allowDisplay || allowChannel ? " (using your effective timezone)." : "."}
            </p>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Display
                </h3>
                <Field label="Timezone" htmlFor="profile-timezone">
                  {allowDisplay ? (
                    <TimezoneCombobox
                      id="profile-timezone"
                      value={tzOverride}
                      allowEmpty
                      emptyLabel={`Use organization default (${timezoneShortLabel(effective.timezone)})`}
                      onChange={setTzOverride}
                    />
                  ) : (
                    <LockedValue value={timezoneDisplayLabel(effective.timezone)} compact />
                  )}
                </Field>
                <Field label="Date format" htmlFor="profile-date-format">
                  {allowDisplay ? (
                    <select
                      id="profile-date-format"
                      className="tg-select"
                      value={dateOverride || ""}
                      onChange={(e) => setDateOverride(e.target.value)}
                    >
                      <option value="">Use organization default ({effective.date_format})</option>
                      {DATE_FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <LockedValue value={effective.date_format} compact />
                  )}
                </Field>
                <Field label="Time format" htmlFor="profile-time-format">
                  {allowDisplay ? (
                    <select
                      id="profile-time-format"
                      className="tg-select"
                      value={timeOverride || ""}
                      onChange={(e) => setTimeOverride(e.target.value)}
                    >
                      <option value="">Use organization default ({effective.time_format})</option>
                      {TIME_FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <LockedValue
                      value={effective.time_format === "24h" ? "24-hour" : "12-hour"}
                      compact
                    />
                  )}
                </Field>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reminders
                </h3>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">Email reminders</div>
                    <div className="text-xs text-muted-foreground">
                      {allowChannel
                        ? "Due / overdue calibration emails"
                        : "Controlled by your organization"}
                    </div>
                  </div>
                  <Switch
                    checked={profile.notifyEmail}
                    disabled={!allowChannel}
                    onCheckedChange={(v) => set("notifyEmail", v)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">In-app reminders</div>
                    <div className="text-xs text-muted-foreground">
                      {allowChannel
                        ? "Show in the Notifications inbox"
                        : "Controlled by your organization"}
                    </div>
                  </div>
                  <Switch
                    checked={profile.notifyInApp}
                    disabled={!allowChannel}
                    onCheckedChange={(v) => set("notifyInApp", v)}
                  />
                </div>
              </div>
            </div>
          </Section>

          {needsOnboarding(profile.role) ? (
            <Section
              title="Product tour"
              description="Replay the guided walkthrough of Scan, equipment, reports, notifications, and more."
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-lg text-xs text-muted-foreground">
                  Useful after a role change or for a quick refresher. The tour pauses anytime — resume
                  from the top bar.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={replayingTour}
                  onClick={() => {
                    setReplayingTour(true);
                    void resetProductTour()
                      .then((u) => {
                        sessionStorage.removeItem("tg-tour-running");
                        sessionStorage.removeItem("tg-tour-paused");
                        sessionStorage.removeItem("tg-tour-step");
                        sessionStorage.setItem("tg-tour-resume", "1");
                        sessionStorage.setItem("tg-tour-fresh", "1");
                        window.dispatchEvent(
                          new CustomEvent("tg-user-profile-updated", { detail: u }),
                        );
                        toast.success("Starting product tour…");
                        return navigate({ to: "/workspace/$slug", params: { slug } });
                      })
                      .catch((e) =>
                        toast.error(e instanceof Error ? e.message : "Could not start tour"),
                      )
                      .finally(() => setReplayingTour(false));
                  }}
                >
                  {replayingTour ? "Starting…" : "Replay product tour"}
                </Button>
              </div>
            </Section>
          ) : null}
        </div>

        {/* Sticky save when dirty */}
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 transition-all duration-200",
            dirty
              ? "translate-y-0 opacity-100"
              : "translate-y-3 opacity-0",
          )}
          aria-hidden={!dirty}
        >
          <div
            className={cn(
              "pointer-events-auto flex max-w-lg flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm",
              !dirty && "invisible",
            )}
          >
            <p className="text-sm text-muted-foreground">You have unsaved profile changes</p>
            <Button onClick={() => void onSave()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading profile">
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs sm:p-6">
        <div className="flex items-center gap-4 sm:gap-5">
          <Skeleton className="h-20 w-20 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-7 w-48 max-w-full" />
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

function PwCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={cn(
        "flex items-center gap-2",
        ok ? "text-success" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "grid h-4 w-4 place-items-center rounded-full border",
          ok ? "border-success/40 bg-success/15" : "border-border bg-transparent",
        )}
      >
        {ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      </span>
      {label}
    </li>
  );
}

function LockedValue({ value, compact }: { value: string; compact?: boolean }) {
  return (
    <div>
      <Input value={value} disabled readOnly />
      {!compact ? (
        <p className="mt-1 text-xs text-muted-foreground">Set by your organization admin</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
  icon,
}: {
  title: string;
  description: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-2">
        {icon ? <div className="mt-0.5">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
