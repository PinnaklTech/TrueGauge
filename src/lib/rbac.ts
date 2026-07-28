import type { UserRole } from "@/lib/api";

/** Matches backend ADMIN_ROLES / WRITER_ROLES in app/deps.py */

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "platform_admin";
}

/** Non-admins eligible for first-login profile + product tour */
export function needsOnboarding(role: string | null | undefined): boolean {
  return role === "qa" || role === "technician" || role === "member";
}

export function isWorkspaceAdmin(role: string | null | undefined): boolean {
  return isAdminRole(role);
}

export function canWrite(role: string | null | undefined): boolean {
  return (
    role === "admin" ||
    role === "platform_admin" ||
    role === "qa" ||
    role === "technician"
  );
}

/** Equipment / calibration hard deletes — admin, QA, technician */
export function canDelete(role: string | null | undefined): boolean {
  return canWrite(role);
}

export function canManagePeople(role: string | null | undefined): boolean {
  return isAdminRole(role);
}

export function canAccessSettings(role: string | null | undefined): boolean {
  return isAdminRole(role);
}

/** Manage dept/category/location registers from Equipment (not Settings). */
export function canManageEquipmentTaxonomy(role: string | null | undefined): boolean {
  return canWrite(role);
}

export type MeLike = { role: UserRole | string } | null | undefined;
