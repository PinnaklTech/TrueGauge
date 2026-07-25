import type { CalStatus, Equipment, NotificationItem } from "@/lib/mock-data";
import { differenceInCalendarDays, isValid, parseISO } from "date-fns";

const ORG_KEY = "tg-org-profile";

export type OrgProfile = {
  companyName: string;
  industry: string;
  address: string;
  timezone: string;
  accentColor: string;
};

export const defaultOrgProfile: OrgProfile = {
  companyName: "",
  industry: "",
  address: "",
  timezone: "UTC",
  accentColor: "#0f766e",
};

export function loadOrgProfile(): OrgProfile {
  if (typeof window === "undefined") return defaultOrgProfile;
  try {
    const raw = localStorage.getItem(ORG_KEY);
    if (!raw) return defaultOrgProfile;
    return { ...defaultOrgProfile, ...JSON.parse(raw) };
  } catch {
    return defaultOrgProfile;
  }
}

export function saveOrgProfile(profile: OrgProfile) {
  localStorage.setItem(ORG_KEY, JSON.stringify(profile));
}

const USER_KEY = "tg-user-profile";

export type UserProfile = {
  fullName: string;
  email: string;
  jobTitle: string;
  department: string;
  phone: string;
  role: "platform_admin" | "admin" | "qa" | "technician" | "member";
  timezone: string;
  locale: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
};

export const defaultUserProfile: UserProfile = {
  fullName: "",
  email: "",
  jobTitle: "Administrator",
  department: "Quality",
  phone: "",
  role: "admin",
  timezone: "UTC",
  locale: "en-US",
  notifyEmail: true,
  notifyInApp: true,
};

export function loadUserProfile(): UserProfile {
  if (typeof window === "undefined") return defaultUserProfile;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return defaultUserProfile;
    return { ...defaultUserProfile, ...JSON.parse(raw) };
  } catch {
    return defaultUserProfile;
  }
}

export function saveUserProfile(profile: UserProfile) {
  localStorage.setItem(USER_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent("tg-user-profile-updated"));
}

export function userInitials(profile: UserProfile) {
  const name = profile.fullName.trim();
  if (!name) return "AD";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function roleDisplayLabel(role: string) {
  const map: Record<string, string> = {
    platform_admin: "True Gauge Admin",
    admin: "Admin",
    qa: "QA",
    technician: "Technician",
    member: "Member",
  };
  return map[role] ?? role;
}

export function parseDate(value: string) {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

export function daysUntilDue(equipment: Equipment, from = new Date()) {
  const next = parseDate(equipment.nextCalibration);
  if (!next) return null;
  return differenceInCalendarDays(next, from);
}

export function complianceScore(equipment: Equipment[]) {
  const active = equipment.filter((e) => e.status !== "inactive");
  if (active.length === 0) return 0;
  const compliant = active.filter((e) => e.status === "calibrated").length;
  return Math.round((compliant / active.length) * 100);
}

export function statusBreakdown(equipment: Equipment[]) {
  const counts: Record<CalStatus, number> = {
    calibrated: 0,
    "due-soon": 0,
    overdue: 0,
    failed: 0,
    inactive: 0,
  };
  for (const e of equipment) counts[e.status] += 1;
  return counts;
}

export function urgencyBuckets(equipment: Equipment[]) {
  const overdue: Array<Equipment & { days: number }> = [];
  const critical: Array<Equipment & { days: number }> = [];
  const normal: Array<Equipment & { days: number }> = [];

  for (const e of equipment) {
    if (e.status === "inactive") continue;
    const days = daysUntilDue(e);
    if (days === null) continue;
    const row = { ...e, days };
    if (e.status === "overdue" || e.status === "failed" || days < 0) overdue.push(row);
    else if (days <= 3) critical.push(row);
    else if (days <= 30) normal.push(row);
  }

  overdue.sort((a, b) => a.days - b.days);
  critical.sort((a, b) => a.days - b.days);
  normal.sort((a, b) => a.days - b.days);
  return { overdue, critical, normal };
}

export function synthesizeNotifications(equipment: Equipment[]): NotificationItem[] {
  const items: NotificationItem[] = [];
  const { overdue, critical } = urgencyBuckets(equipment);

  for (const e of overdue.slice(0, 8)) {
    items.push({
      id: `overdue-${e.id}`,
      type: "reminder",
      title: "Calibration Overdue",
      body: `${e.name} (${e.tag}) next calibration date was ${e.nextCalibration || "unknown"} and is now overdue.`,
      when: e.nextCalibration || new Date().toISOString().slice(0, 10),
      read: false,
    });
  }

  for (const e of critical.slice(0, 5)) {
    items.push({
      id: `due-${e.id}`,
      type: "reminder",
      title: `Calibration Due in ${e.days} Day${e.days === 1 ? "" : "s"}`,
      body: `${e.name} (${e.tag}) is scheduled for calibration on ${e.nextCalibration}.`,
      when: new Date().toISOString().slice(0, 10),
      read: false,
    });
  }

  return items;
}

export function categoryCompliance(equipment: Equipment[]) {
  const map = new Map<string, { total: number; calibrated: number }>();
  for (const e of equipment) {
    if (e.status === "inactive") continue;
    const key = e.category || "Uncategorized";
    const row = map.get(key) ?? { total: 0, calibrated: 0 };
    row.total += 1;
    if (e.status === "calibrated") row.calibrated += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      calibrated: v.calibrated,
      total: v.total,
      pct: v.total ? Math.round((v.calibrated / v.total) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct);
}
