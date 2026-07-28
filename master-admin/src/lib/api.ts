import { clearToken, getRefreshToken, getToken, setSessionTokens } from "@/lib/auth";

function resolveViteUrl(value: string | undefined, devFallback: string, label: string): string {
  const trimmed = (value || "").trim().replace(/\/$/, "");
  if (trimmed) return trimmed;
  if (import.meta.env.DEV) return devFallback;
  throw new Error(
    `Missing ${label}. Set it at build time (see master-admin/.env.production.example).`,
  );
}

export const API_URL = resolveViteUrl(
  import.meta.env.VITE_API_URL as string | undefined,
  "http://localhost:8000",
  "VITE_API_URL",
);
export const APP_URL = resolveViteUrl(
  import.meta.env.VITE_APP_URL as string | undefined,
  "http://localhost:8080",
  "VITE_APP_URL",
);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role: string;
  tenant_id?: number | null;
  active?: boolean;
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string | null;
  user: AuthUser;
  tenant_id: number;
  tenant_name: string;
  expires_in?: number;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const session = (await res.json()) as AuthSession;
        setSessionTokens(session.access_token, session.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (
      res.status === 401 &&
      !retried &&
      !path.startsWith("/api/auth/staff-login") &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/refresh")
    ) {
      const ok = await tryRefresh();
      if (ok) return request<T>(path, init, true);
      clearToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TenantItem {
  id: number;
  slug: string;
  name: string;
  active: boolean;
  storage_enabled?: boolean;
  created_at?: string | null;
  user_count: number;
  equipment_count: number;
  overdue_count: number;
  smtp_configured?: boolean;
  odoo_configured?: boolean;
}

export interface TenantDetail extends TenantItem {
  company_name: string;
  industry: string;
  address: string;
  timezone: string;
  accent_color: string;
  smtp_configured: boolean;
  odoo_configured: boolean;
}

export interface DayCount {
  date: string;
  count?: number;
  sent?: number;
  failed?: number;
  ok?: number;
  fail?: number;
}

export interface PlatformOverview {
  tenant_count: number;
  active_tenant_count: number;
  inactive_tenant_count: number;
  user_count: number;
  staff_count: number;
  email_7d_sent: number;
  email_7d_failed: number;
  smtp_configured_tenants: number;
  odoo_configured_tenants: number;
  auth_events_24h: number;
  auth_failures_24h: number;
  onboardings_30d: number;
  recent_tenants: TenantItem[];
  system_status: string;
  database_status: string;
  system_smtp_ready: boolean;
  onboardings_by_day: DayCount[];
  emails_by_day: DayCount[];
  auth_by_day: DayCount[];
  attention_suspended: number;
  attention_failed_welcomes_7d: number;
  attention_active_without_smtp: number;
}

export interface ActivityItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  tenant_id?: number | null;
  tenant_name: string;
  created_at?: string | null;
}

export interface PlatformHealth {
  status: string;
  database: string;
  environment: string;
}

export interface PlatformUser {
  id: number;
  email: string;
  full_name: string;
  role: string;
  active: boolean;
  tenant_id?: number | null;
  tenant_name?: string;
  created_at?: string | null;
}

export interface OrgUser extends AuthUser {
  job_title?: string;
  department?: string;
  active?: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface TenantSummary {
  tenant_id: number;
  name: string;
  slug: string;
  active: boolean;
  storage_enabled: boolean;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  certificate_count: number;
  user_count: number;
  active_user_count: number;
  admin_count: number;
  equipment_count: number;
  overdue_count: number;
  calibration_count: number;
  email_7d_sent: number;
  email_7d_failed: number;
  smtp_configured: boolean;
  odoo_configured: boolean;
  system_smtp_ready: boolean;
  timezone: string;
  company_name: string;
  industry: string;
  address: string;
  accent_color: string;
  odoo_url?: string | null;
  odoo_connected: boolean;
  odoo_last_error?: string | null;
  smtp_host?: string | null;
  smtp_from_email?: string | null;
  last_auth_at?: string | null;
  last_email_at?: string | null;
  checklist: ChecklistItem[];
}

export interface EmailAuditItem {
  id: number;
  kind: string;
  subject: string;
  to_email: string;
  to_name: string;
  status: string;
  error?: string | null;
  equipment_count: number;
  detail?: string | null;
  org_member?: boolean;
  created_at: string;
  tenant_id?: number;
  tenant_name?: string;
}

export interface TenantEquipmentItem {
  id: string;
  tag: string;
  name: string;
  status: string;
  department: string;
  location: string;
  next_calibration?: string | null;
  last_calibration?: string | null;
  owner: string;
}

export interface DataSummary {
  tenants: number;
  users: number;
  staff: number;
  equipment: number;
  calibrations: number;
  email_audits: number;
  auth_events: number;
  notifications: number;
  system_smtp_ready: boolean;
}

export interface DataTable {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export type OrgRole = "admin" | "qa" | "technician" | "member";

export async function staffLogin(email: string, password: string, passcode: string) {
  const session = await request<AuthSession>("/api/auth/staff-login", {
    method: "POST",
    body: JSON.stringify({ email, password, passcode }),
  });
  if (session.user.role !== "platform_admin") {
    throw new ApiError("Master Admin is for TrueGage platform admins only", 403);
  }
  return session;
}

export async function getMe() {
  return request<AuthUser & { tenant_id: number; tenant_name: string }>("/api/auth/me");
}

export async function getOverview() {
  return request<PlatformOverview>("/api/platform/overview");
}

export async function getPlatformHealth() {
  return request<PlatformHealth>("/api/platform/health");
}

export async function getActivity(limit = 50, category = "all") {
  return request<{ items: ActivityItem[]; total: number }>(
    `/api/platform/activity?limit=${limit}&category=${encodeURIComponent(category)}`,
  );
}

export async function listTenants() {
  return request<{ items: TenantItem[]; total: number }>("/api/tenants");
}

export async function getTenant(id: number) {
  return request<TenantDetail>(`/api/tenants/${id}`);
}

export async function createTenant(payload: {
  name: string;
  slug?: string;
  admin_email: string;
  admin_password: string;
  admin_full_name?: string;
  send_welcome_email?: boolean;
}) {
  return request<TenantItem>("/api/tenants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTenant(
  id: number,
  payload: { name?: string; slug?: string; active?: boolean; storage_enabled?: boolean },
) {
  return request<TenantDetail>(`/api/tenants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteTenant(id: number, confirmSlug: string) {
  await request<void>(
    `/api/tenants/${id}?confirm_slug=${encodeURIComponent(confirmSlug)}`,
    { method: "DELETE" },
  );
}

export type PlatformSmtp = {
  configured: boolean;
  source: "db" | "env" | "none" | string;
  smtp_host?: string | null;
  smtp_port: number;
  smtp_username?: string | null;
  smtp_use_tls: boolean;
  smtp_from_email?: string | null;
  smtp_from_name?: string | null;
  has_password: boolean;
  last_error?: string | null;
  env_fallback_ready: boolean;
};

export async function getPlatformSmtp() {
  return request<PlatformSmtp>("/api/platform/smtp");
}

export async function savePlatformSmtp(payload: {
  smtp_host: string;
  smtp_port: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_use_tls: boolean;
  smtp_from_email: string;
  smtp_from_name?: string;
}) {
  return request<PlatformSmtp>("/api/platform/smtp", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testPlatformSmtp(toEmail: string) {
  return request<{ ok: boolean; message: string }>("/api/platform/smtp/test", {
    method: "POST",
    body: JSON.stringify({ to_email: toEmail }),
  });
}

export async function createHandoffCode(id: number) {
  return request<{ code: string; expires_in: number }>(`/api/tenants/${id}/handoff`, {
    method: "POST",
  });
}

export async function listTenantUsers(tenantId: number) {
  return request<{ items: OrgUser[]; total: number }>(`/api/platform/tenants/${tenantId}/users`);
}

export async function forcePassword(tenantId: number, userId: number, password: string) {
  return request<OrgUser>(`/api/tenants/${tenantId}/users/${userId}/force-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function getTenantSummary(tenantId: number) {
  return request<TenantSummary>(`/api/platform/tenants/${tenantId}/summary`);
}

export async function createTenantUser(
  tenantId: number,
  payload: {
    email: string;
    password: string;
    full_name?: string;
    role?: OrgRole;
    job_title?: string;
    department?: string;
  },
) {
  return request<OrgUser>(`/api/platform/tenants/${tenantId}/users`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTenantUser(
  tenantId: number,
  userId: number,
  payload: {
    full_name?: string;
    email?: string;
    role?: OrgRole;
    job_title?: string;
    department?: string;
    active?: boolean;
    password?: string;
  },
) {
  return request<OrgUser>(`/api/platform/tenants/${tenantId}/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function revokeTenantUserSessions(tenantId: number, userId: number) {
  return request<OrgUser>(`/api/platform/tenants/${tenantId}/users/${userId}/revoke-sessions`, {
    method: "POST",
  });
}

export async function resendWelcomeEmail(
  tenantId: number,
  payload: { password: string; user_id?: number },
) {
  return request<EmailAuditItem>(`/api/platform/tenants/${tenantId}/welcome-email`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTenantOrg(
  tenantId: number,
  payload: {
    company_name: string;
    industry: string;
    address: string;
    timezone: string;
    accent_color: string;
  },
) {
  return request<{
    company_name: string;
    industry: string;
    address: string;
    timezone: string;
    accent_color: string;
  }>(`/api/platform/tenants/${tenantId}/org`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getTenantEmailHistory(tenantId: number, status = "", limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  return request<{ items: EmailAuditItem[]; total: number }>(
    `/api/platform/tenants/${tenantId}/email-history?${params}`,
  );
}

export async function getTenantEquipment(tenantId: number, status = "", limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  return request<{ items: TenantEquipmentItem[]; total: number }>(
    `/api/platform/tenants/${tenantId}/equipment?${params}`,
  );
}

export async function getTenantActivity(tenantId: number, limit = 50) {
  return request<{ items: ActivityItem[]; total: number }>(
    `/api/platform/tenants/${tenantId}/activity?limit=${limit}`,
  );
}

export async function getEmailQueue(status = "", kind = "", limit = 80) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  if (kind) params.set("kind", kind);
  return request<{ items: EmailAuditItem[]; total: number }>(`/api/platform/email-queue?${params}`);
}

export async function listStaff() {
  return request<{ items: PlatformUser[]; total: number }>("/api/platform/staff");
}

export async function createStaff(payload: { email: string; password: string; full_name?: string }) {
  return request<PlatformUser>("/api/platform/staff", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateStaff(
  id: number,
  payload: { full_name?: string; active?: boolean; password?: string },
) {
  return request<PlatformUser>(`/api/platform/staff/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function listPlatformUsers(q = "") {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return request<{ items: PlatformUser[]; total: number }>(`/api/platform/users${qs}`);
}

export async function getDataSummary() {
  return request<DataSummary>("/api/platform/data/summary");
}

export async function getDataTable(table: string, limit = 50, offset = 0) {
  return request<DataTable>(`/api/platform/data/${table}?limit=${limit}&offset=${offset}`);
}
