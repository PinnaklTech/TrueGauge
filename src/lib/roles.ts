import type { OrgUserRole, UserRole } from "@/lib/api";

export type WorkspaceRole = OrgUserRole;

export const WORKSPACE_ROLES: WorkspaceRole[] = ["admin", "qa", "technician", "member"];

export const ROLE_META: Record<
  WorkspaceRole,
  { label: string; short: string; blurb: string }
> = {
  admin: {
    label: "Admin",
    short: "Full workspace control",
    blurb: "Manage people, settings, integrations, email, and all equipment/calibration data.",
  },
  qa: {
    label: "QA",
    short: "Write equipment & calibrations",
    blurb:
      "Create, update, and delete equipment and calibrations. Manage departments, categories, and locations from Equipment. Cannot manage users or settings.",
  },
  technician: {
    label: "Technician",
    short: "Write equipment & calibrations",
    blurb:
      "Create, update, and delete equipment and calibrations. Manage departments, categories, and locations from Equipment. Cannot manage users or settings.",
  },
  member: {
    label: "Member",
    short: "Read-only",
    blurb: "View equipment, calibrations, and notifications. Cannot create or change records.",
  },
};

export type PermissionKey =
  | "settings"
  | "people"
  | "org_integrations"
  | "reminder_rules"
  | "equipment_taxonomy"
  | "equipment_write"
  | "equipment_delete"
  | "calibrations_write"
  | "send_overdue_email"
  | "notify_prefs"
  | "read";

export const PERMISSION_ROWS: Array<{
  key: PermissionKey;
  label: string;
  admin: boolean;
  qa: boolean;
  technician: boolean;
  member: boolean;
}> = [
  { key: "settings", label: "Open Settings", admin: true, qa: false, technician: false, member: false },
  {
    key: "people",
    label: "Manage people & roles",
    admin: true,
    qa: false,
    technician: false,
    member: false,
  },
  {
    key: "org_integrations",
    label: "Org profile, SMTP, Odoo",
    admin: true,
    qa: false,
    technician: false,
    member: false,
  },
  {
    key: "reminder_rules",
    label: "Manage reminder rules",
    admin: true,
    qa: false,
    technician: false,
    member: false,
  },
  {
    key: "equipment_taxonomy",
    label: "Manage dept / category / location lists (Equipment)",
    admin: true,
    qa: true,
    technician: true,
    member: false,
  },
  {
    key: "equipment_write",
    label: "Create / edit equipment",
    admin: true,
    qa: true,
    technician: true,
    member: false,
  },
  {
    key: "equipment_delete",
    label: "Delete equipment & calibrations",
    admin: true,
    qa: true,
    technician: true,
    member: false,
  },
  {
    key: "calibrations_write",
    label: "Log calibrations",
    admin: true,
    qa: true,
    technician: true,
    member: false,
  },
  {
    key: "send_overdue_email",
    label: "Send overdue alert emails",
    admin: true,
    qa: false,
    technician: false,
    member: false,
  },
  {
    key: "notify_prefs",
    label: "Personal email / in-app notify prefs",
    admin: true,
    qa: true,
    technician: true,
    member: true,
  },
  {
    key: "read",
    label: "View equipment & history",
    admin: true,
    qa: true,
    technician: true,
    member: true,
  },
];

export function roleDisplayLabel(role: string) {
  if (role === "platform_admin") return "TrueGage Admin";
  if (role in ROLE_META) return ROLE_META[role as WorkspaceRole].label;
  return role;
}

export function roleBlurb(role: string) {
  if (role in ROLE_META) return ROLE_META[role as WorkspaceRole].blurb;
  return "";
}

export function asWorkspaceRole(role: UserRole | string): WorkspaceRole | null {
  if (role === "admin" || role === "qa" || role === "technician" || role === "member") return role;
  return null;
}
