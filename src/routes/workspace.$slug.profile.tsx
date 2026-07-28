import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/tg/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMe, getOrgTaxonomy, resetProductTour, updateMe, type AuthUser } from "@/lib/api";
import { roleDisplayLabel, userInitials, type UserProfile } from "@/lib/compliance";
import { needsOnboarding } from "@/lib/rbac";
import { toast } from "sonner";
import { Eye, EyeOff, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/workspace/$slug/profile")({
  head: () => ({ meta: [{ title: "Profile · TrueGage" }] }),
  component: ProfilePage,
});

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

function ProfilePage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [replayingTour, setReplayingTour] = useState(false);

  useEffect(() => {
    void getMe()
      .then((u) => setProfile(fromApi(u)))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load profile"))
      .finally(() => setLoading(false));
    void getOrgTaxonomy()
      .then((t) => setDepartments(t.departments))
      .catch(() => setDepartments([]));
  }, []);

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  };

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
        timezone: profile.timezone,
        notify_email: profile.notifyEmail,
        notify_in_app: profile.notifyInApp,
      });
      setProfile(fromApi(updated));
      window.dispatchEvent(new CustomEvent("tg-user-profile-updated"));
      toast.success("Profile saved to database");
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
    if (newPassword.length < 12) {
      toast.error("New password must be at least 12 characters");
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
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </AppShell>
    );
  }

  const initials = userInitials(profile);

  return (
    <AppShell breadcrumbs={[{ label: "Profile" }]} hidePageHeader>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            My Profile
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Account details are stored in the TrueGage database and used across the workspace.
          </p>
        </div>
        <Button onClick={() => void onSave()} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="mb-6 flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="font-display text-lg font-semibold text-foreground">
            {profile.fullName.trim() || "Administrator"}
          </div>
          <div className="text-sm text-muted-foreground">
            {roleDisplayLabel(profile.role)}
            {profile.department ? ` · ${profile.department}` : ""}
            {profile.jobTitle ? ` · ${profile.jobTitle}` : ""}
          </div>
          {profile.email && (
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">{profile.email}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section
          title="Personal information"
          description="Shown in the sidebar and used as the account identity for this workspace."
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
            </Field>
          </div>
        </Section>

        <Section title="Security" description="Change your sign-in password.">
          <div className="grid gap-3 sm:grid-cols-1">
            <Field label="Current password" htmlFor="profile-current-pw">
              <PasswordInput
                id="profile-current-pw"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
                placeholder="Temporary password from your invite email"
              />
            </Field>
            <Field label="New password (min 12)" htmlFor="profile-new-pw">
              <PasswordInput
                id="profile-new-pw"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                placeholder="At least 6 characters"
              />
            </Field>
            <Field label="Confirm new password" htmlFor="profile-confirm-pw">
              <PasswordInput
                id="profile-confirm-pw"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void onChangePassword()}
                disabled={changingPassword}
              >
                {changingPassword ? "Updating…" : "Change password"}
              </Button>
              <p className="text-xs text-muted-foreground">
                After first login from an invite, use the temporary password as “Current password”.
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Sign out from the sidebar when finished on a shared machine. If you are locked out, ask an
            admin to reset your password in Settings → People & access.
          </div>
        </Section>

        <Section
          title="Preferences"
          description="Reminder schedule uses company timezone; your timezone is used in emails and dates."
        >
          <div className="grid gap-4">
            <Field label="Your timezone" htmlFor="profile-timezone">
              <select
                id="profile-timezone"
                className="tg-select"
                value={profile.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                <option value="UTC">UTC</option>
                <option value="America/Chicago">Central Standard Time (CST)</option>
                <option value="America/New_York">Eastern Time (ET)</option>
                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                <option value="Europe/London">London (GMT/BST)</option>
                <option value="Asia/Kolkata">India Standard Time (IST)</option>
              </select>
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">Email reminders</div>
                <div className="text-xs text-muted-foreground">
                  Receive due / overdue calibration emails
                </div>
              </div>
              <Switch
                checked={profile.notifyEmail}
                onCheckedChange={(v) => set("notifyEmail", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">In-app reminders</div>
                <div className="text-xs text-muted-foreground">
                  Show due / overdue items in the notifications inbox
                </div>
              </div>
              <Switch
                checked={profile.notifyInApp}
                onCheckedChange={(v) => set("notifyInApp", v)}
              />
            </div>
            {needsOnboarding(profile.role) ? (
              <div className="rounded-lg border border-border bg-surface/40 px-4 py-3">
                <div className="text-sm font-medium text-foreground">Product tour</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Replay the guided walkthrough of Dashboard and navigation.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
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
            ) : null}
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
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
