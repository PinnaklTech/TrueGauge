import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/tg/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getMe, updateMe, type AuthUser, type UserRole } from "@/lib/api";
import { roleDisplayLabel, userInitials, type UserProfile } from "@/lib/compliance";
import { toast } from "sonner";
import { Info, Shield } from "lucide-react";

export const Route = createFileRoute("/profile")({
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getMe()
      .then((u) => setProfile(fromApi(u)))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load profile"))
      .finally(() => setLoading(false));
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
        phone: profile.phone.trim(),
        role: profile.role as UserRole,
        timezone: profile.timezone,
        locale: profile.locale,
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
            <Field label="Job title" htmlFor="profile-job-title">
              <Input
                id="profile-job-title"
                value={profile.jobTitle}
                onChange={(e) => set("jobTitle", e.target.value)}
                placeholder="Quality Manager"
              />
            </Field>
            <Field label="Department" htmlFor="profile-department">
              <Input
                id="profile-department"
                value={profile.department}
                onChange={(e) => set("department", e.target.value)}
                placeholder="Quality"
              />
            </Field>
            <Field label="Role" htmlFor="profile-role">
              <select
                id="profile-role"
                value={profile.role}
                onChange={(e) => set("role", e.target.value as UserProfile["role"])}
                className="tg-select"
              >
                <option value="admin">Admin</option>
                <option value="qa">QA</option>
                <option value="technician">Technician</option>
                <option value="member">Member</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section
          title="Contact"
          description="Used for account communication and notification delivery."
        >
          <div className="grid gap-4">
            <Field label="Work email" htmlFor="profile-email">
              <Input
                id="profile-email"
                type="email"
                value={profile.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="you@company.com"
              />
            </Field>
            <Field label="Phone" htmlFor="profile-phone">
              <Input
                id="profile-phone"
                value={profile.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+1 555 0100"
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Preferences"
          description="Locale and how you want to receive alerts in this app."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="profile-timezone">
              <select
                id="profile-timezone"
                value={profile.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                className="tg-select"
              >
                <option value="UTC">UTC</option>
                <option value="America/Chicago">Central (CST/CDT)</option>
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
                <option value="Europe/London">London (GMT/BST)</option>
                <option value="Asia/Kolkata">India (IST)</option>
              </select>
            </Field>
            <Field label="Locale" htmlFor="profile-locale">
              <select
                id="profile-locale"
                value={profile.locale}
                onChange={(e) => set("locale", e.target.value)}
                className="tg-select"
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="de-DE">German</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-foreground">Email notifications</div>
                <div className="text-xs text-muted-foreground">Receive overdue and reminder emails</div>
              </div>
              <Switch
                checked={profile.notifyEmail}
                onCheckedChange={(v) => set("notifyEmail", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-foreground">In-app notifications</div>
                <div className="text-xs text-muted-foreground">Show alerts in the notification center</div>
              </div>
              <Switch
                checked={profile.notifyInApp}
                onCheckedChange={(v) => set("notifyInApp", v)}
              />
            </div>
          </div>
        </Section>

        <Section title="Security" description="Password changes and account access.">
          <div className="flex gap-2 rounded-lg border border-border bg-surface/50 px-3 py-3 text-sm text-muted-foreground">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Your login is stored securely in the database. To change password, use{" "}
              <Link to="/auth/forgot" className="text-primary hover:underline">
                forgot password
              </Link>{" "}
              (reset flow coming soon) or ask an admin.
            </div>
          </div>
          <div className="mt-3 flex gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Sign out from the sidebar menu when finished on a shared machine.
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
