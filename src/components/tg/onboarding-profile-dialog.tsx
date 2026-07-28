import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getOrgTaxonomy, updateMe, type AuthUser } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  open: boolean;
  user: AuthUser;
  onCompleted: (user: AuthUser) => void;
};

export function OnboardingProfileDialog({ open, user, onCompleted }: Props) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [jobTitle, setJobTitle] = useState(user.job_title || "");
  const [department, setDepartment] = useState(user.department || "");
  const [timezone, setTimezone] = useState(user.timezone || "UTC");
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyInApp, setNotifyInApp] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(user.full_name || "");
    setJobTitle(user.job_title || "");
    setDepartment(user.department || "");
    setTimezone(user.timezone || "UTC");
    // First-time setup: start opted out — user turns alerts on if they want them
    setNotifyEmail(false);
    setNotifyInApp(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    void getOrgTaxonomy()
      .then((t) => setDepartments(t.departments))
      .catch(() => setDepartments([]));
  }, [open, user]);

  const save = async (skip: boolean) => {
    if (!skip && !fullName.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    if (newPassword || confirmPassword || currentPassword) {
      if (newPassword.length < 12) {
        toast.error("New password must be at least 12 characters");
        return;
      }
      if (newPassword !== confirmPassword) {
        toast.error("New password and confirmation do not match");
        return;
      }
      if (!currentPassword) {
        toast.error("Enter your temporary password to set a new one");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Parameters<typeof updateMe>[0] = {
        mark_profile_setup: true,
      };
      if (!skip) {
        payload.full_name = fullName.trim();
        payload.job_title = jobTitle.trim();
        payload.department = department.trim();
        payload.timezone = timezone;
        payload.notify_email = notifyEmail;
        payload.notify_in_app = notifyInApp;
      }
      if (newPassword && currentPassword) {
        payload.current_password = currentPassword;
        payload.password = newPassword;
      }
      const updated = await updateMe(payload);
      toast.success(skip ? "You can finish your profile anytime" : "Profile saved");
      onCompleted(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg [&_[data-slot=dialog-close],&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Welcome to TrueGage</DialogTitle>
          <DialogDescription>
            Set up your profile so reminders and your workspace identity look right. This only takes a
            minute.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <Field label="Full name" htmlFor="onb-name">
            <Input
              id="onb-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job title" htmlFor="onb-job">
              <Input
                id="onb-job"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Quality Manager"
              />
            </Field>
            <Field label="Department" htmlFor="onb-dept">
              <select
                id="onb-dept"
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
            </Field>
          </div>
          <Field label="Your timezone" htmlFor="onb-tz">
            <select
              id="onb-tz"
              className="tg-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option value="UTC">UTC</option>
              <option value="America/Chicago">Central Standard Time (CST)</option>
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="Europe/London">London (GMT/BST)</option>
              <option value="Asia/Kolkata">India Standard Time (IST)</option>
            </select>
          </Field>

          <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Email reminders</div>
                <div className="text-xs text-muted-foreground">Calibration due / overdue emails</div>
              </div>
              <Switch checked={notifyEmail} onCheckedChange={setNotifyEmail} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">In-app reminders</div>
                <div className="text-xs text-muted-foreground">Show alerts in Notifications</div>
              </div>
              <Switch checked={notifyInApp} onCheckedChange={setNotifyInApp} />
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border p-3">
            <p className="mb-3 text-xs text-muted-foreground">
              Optional — if you signed in with a temporary password, set a new one now.
            </p>
            <div className="grid gap-3">
              <Field label="Current (temporary) password" htmlFor="onb-cur-pw">
                <Input
                  id="onb-cur-pw"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field label="New password" htmlFor="onb-new-pw">
                <Input
                  id="onb-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="onb-confirm-pw">
                <Input
                  id="onb-confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void save(true)}>
            Skip for now
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save(false)}>
            {saving ? "Saving…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
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
