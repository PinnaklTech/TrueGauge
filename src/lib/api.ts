import type { CalStatus, Equipment } from "@/lib/mock-data";
import { clearToken, getRefreshToken, getToken, setSessionTokens } from "@/lib/auth";

function resolveViteUrl(value: string | undefined, devFallback: string, label: string): string {
  const trimmed = (value || "").trim().replace(/\/$/, "");
  if (trimmed) return trimmed;
  if (import.meta.env.DEV) return devFallback;
  throw new Error(
    `Missing ${label}. Set it at build time (see .env.production.example).`,
  );
}

const API_URL = resolveViteUrl(
  import.meta.env.VITE_API_URL as string | undefined,
  "http://localhost:8000",
  "VITE_API_URL",
);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
  const token = typeof window !== "undefined" ? getToken() : null;
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
      typeof window !== "undefined" &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/register") &&
      !path.startsWith("/api/auth/refresh") &&
      !path.startsWith("/api/auth/handoff")
    ) {
      const ok = await tryRefresh();
      if (ok) return request<T>(path, init, true);
      clearToken();
      if (!window.location.pathname.startsWith("/auth")) {
        window.location.href = "/auth/login";
      }
    }
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => d.msg ?? JSON.stringify(d)).join(", ");
    } catch {
      /* ignore */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface OdooStatus {
  configured: boolean;
  connected: boolean;
  odoo_url?: string | null;
  odoo_database?: string | null;
  odoo_username?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
  equipment_count: number;
  field_calibration_date?: string | null;
  field_calibration_due?: string | null;
  field_responsible_email?: string | null;
}

export interface OdooCredentialsPayload {
  odoo_url: string;
  odoo_database: string;
  odoo_username: string;
  odoo_api_key: string;
  field_calibration_date?: string;
  field_calibration_due?: string;
  field_responsible_email?: string;
}

export interface OdooTestResult {
  ok: boolean;
  uid?: number | null;
  version?: string | null;
  message: string;
}

export interface SyncResult {
  ok: boolean;
  imported: number;
  updated?: number;
  skipped: number;
  total_in_odoo: number;
  synced: number;
  message: string;
  synced_at: string;
  fields_used?: string[];
}

export interface EquipmentPayload {
  tag?: string;
  name: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  department?: string;
  location?: string;
  status?: CalStatus;
  last_calibration?: string | null;
  next_calibration?: string | null;
  frequency_days?: number;
  owner?: string;
  responsible_email?: string | null;
}

interface ApiEquipment {
  id: string;
  odoo_id: number | null;
  source: "local" | "odoo";
  tag: string;
  name: string;
  category: string;
  manufacturer: string;
  model: string;
  serial: string;
  department: string;
  location: string;
  status: CalStatus;
  last_calibration: string | null;
  next_calibration: string | null;
  frequency_days: number;
  owner: string;
  responsible_email: string | null;
}

export type AppEquipment = Equipment & {
  source: "local" | "odoo";
  odooId: number | null;
  responsibleEmail: string | null;
};

function toEquipment(row: ApiEquipment): AppEquipment {
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    category: row.category,
    manufacturer: row.manufacturer,
    model: row.model,
    serial: row.serial,
    department: row.department,
    location: row.location,
    status: row.status,
    lastCalibration: row.last_calibration ?? "",
    nextCalibration: row.next_calibration ?? "",
    frequencyDays: row.frequency_days,
    owner: row.owner,
    source: row.source,
    odooId: row.odoo_id,
    responsibleEmail: row.responsible_email,
  };
}

export async function getHealth() {
  return request<{ status: string; database: string }>("/api/health");
}

export async function getOdooStatus() {
  return request<OdooStatus>("/api/odoo/status");
}

export async function saveOdooCredentials(payload: OdooCredentialsPayload) {
  return request<OdooStatus>("/api/odoo/credentials", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testOdooConnection() {
  return request<OdooTestResult>("/api/odoo/test", { method: "POST" });
}

export async function syncOdooEquipment() {
  return request<SyncResult>("/api/odoo/sync", { method: "POST" });
}

export async function listEquipment(params?: { q?: string; status?: string }) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  const qs = sp.toString();
  const data = await request<{ items: ApiEquipment[]; total: number }>(`/api/equipment${qs ? `?${qs}` : ""}`);
  return { items: data.items.map(toEquipment), total: data.total };
}

export async function getEquipment(id: string) {
  const row = await request<ApiEquipment>(`/api/equipment/${encodeURIComponent(id)}`);
  return toEquipment(row);
}

export async function createEquipment(payload: EquipmentPayload) {
  const row = await request<ApiEquipment>("/api/equipment", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return toEquipment(row);
}

export async function updateEquipment(id: string, payload: Partial<EquipmentPayload>) {
  const row = await request<ApiEquipment>(`/api/equipment/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return toEquipment(row);
}

export async function deleteEquipment(id: string) {
  await request<void>(`/api/equipment/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  role: string;
  active: boolean;
  org_member: boolean;
}

export type TeamMemberPayload = {
  email: string;
  name?: string;
  role?: string;
  active?: boolean;
  org_member?: boolean;
};

export async function listTeamMembers() {
  return request<{ items: TeamMember[]; total: number }>("/api/team");
}

export async function createTeamMember(payload: TeamMemberPayload) {
  return request<TeamMember>("/api/team", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTeamMember(id: number, payload: Partial<TeamMemberPayload>) {
  return request<TeamMember>(`/api/team/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteTeamMember(id: number) {
  await request<void>(`/api/team/${id}`, { method: "DELETE" });
}

export interface EmailSettings {
  configured: boolean;
  smtp_host?: string | null;
  smtp_port: number;
  smtp_username?: string | null;
  smtp_use_tls: boolean;
  smtp_from_email?: string | null;
  smtp_from_name?: string | null;
  has_password: boolean;
  last_error?: string | null;
}

export type EmailSettingsPayload = {
  smtp_host: string;
  smtp_port: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_use_tls: boolean;
  smtp_from_email: string;
  smtp_from_name?: string;
};

export interface EmailTestResult {
  member_id: number;
  email: string;
  name: string;
  ok: boolean;
  error?: string | null;
}

export interface EmailTestSendResult {
  ok: boolean;
  sent: number;
  failed: number;
  message: string;
  results: EmailTestResult[];
}

export async function getEmailSettings() {
  return request<EmailSettings>("/api/email/settings");
}

export async function saveEmailSettings(payload: EmailSettingsPayload) {
  return request<EmailSettings>("/api/email/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function sendEmailCheck(memberIds: number[]) {
  return request<EmailTestSendResult>("/api/email/test-send", {
    method: "POST",
    body: JSON.stringify({ member_ids: memberIds }),
  });
}

export interface OverdueAlertSendResult {
  ok: boolean;
  sent: number;
  failed: number;
  equipment_count: number;
  message: string;
  results: EmailTestResult[];
}

export async function sendOverdueAlert(memberIds: number[]) {
  return request<OverdueAlertSendResult>("/api/email/overdue-alert", {
    method: "POST",
    body: JSON.stringify({ member_ids: memberIds }),
  });
}

export type CalResult = "pass" | "fail" | "conditional";
export type ProviderType = "internal" | "external";

export interface AppCalibration {
  id: string;
  equipmentId: string;
  equipmentTag: string;
  equipmentName: string;
  date: string;
  dueDate: string;
  result: CalResult;
  provider: string;
  type: ProviderType;
  technician: string;
  certificateNo: string;
  notes?: string;
}

export type CalibrationPayload = {
  equipment_id: string;
  date: string;
  result?: CalResult;
  type?: ProviderType;
  provider?: string;
  technician?: string;
  certificate_no?: string;
  notes?: string;
  next_calibration?: string | null;
  update_equipment_dates?: boolean;
};

interface ApiCalibration {
  id: string;
  equipment_id: string;
  equipment_tag: string;
  equipment_name: string;
  date: string;
  due_date: string | null;
  result: CalResult;
  provider: string;
  type: ProviderType;
  technician: string;
  certificate_no: string;
  notes: string | null;
}

function toCalibration(row: ApiCalibration): AppCalibration {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    equipmentTag: row.equipment_tag,
    equipmentName: row.equipment_name,
    date: row.date,
    dueDate: row.due_date ?? "",
    result: row.result,
    provider: row.provider,
    type: row.type,
    technician: row.technician,
    certificateNo: row.certificate_no,
    notes: row.notes ?? undefined,
  };
}

export async function listCalibrations(params?: { equipmentId?: string }) {
  const sp = new URLSearchParams();
  if (params?.equipmentId) sp.set("equipment_id", params.equipmentId);
  const qs = sp.toString();
  const data = await request<{ items: ApiCalibration[]; total: number }>(
    `/api/calibrations${qs ? `?${qs}` : ""}`,
  );
  return { items: data.items.map(toCalibration), total: data.total };
}

export async function listEquipmentCalibrations(equipmentId: string) {
  const data = await request<{ items: ApiCalibration[]; total: number }>(
    `/api/equipment/${encodeURIComponent(equipmentId)}/calibrations`,
  );
  return { items: data.items.map(toCalibration), total: data.total };
}

export async function createCalibration(payload: CalibrationPayload) {
  const row = await request<ApiCalibration>("/api/calibrations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return toCalibration(row);
}

export async function deleteCalibration(id: string) {
  await request<void>(`/api/calibrations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface AppCertificate {
  id: string;
  equipmentId: string;
  equipmentTag: string;
  equipmentName: string;
  calibrationId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  uploadedBy: string | null;
  createdAt: string | null;
}

interface ApiCertificate {
  id: string;
  equipment_id: string;
  equipment_tag: string;
  equipment_name: string;
  calibration_id: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  uploaded_by: string | null;
  created_at: string | null;
}

function toCertificate(row: ApiCertificate): AppCertificate {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    equipmentTag: row.equipment_tag,
    equipmentName: row.equipment_name,
    calibrationId: row.calibration_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    status: row.status,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

export const CERTIFICATE_MAX_BYTES = 2 * 1024 * 1024;

export async function listCertificates(params?: { q?: string; equipmentId?: string }) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.equipmentId) sp.set("equipment_id", params.equipmentId);
  const qs = sp.toString();
  const data = await request<{ items: ApiCertificate[]; total: number }>(
    `/api/certificates${qs ? `?${qs}` : ""}`,
  );
  return { items: data.items.map(toCertificate), total: data.total };
}

export async function listEquipmentCertificates(equipmentId: string) {
  const data = await request<{ items: ApiCertificate[]; total: number }>(
    `/api/equipment/${encodeURIComponent(equipmentId)}/certificates`,
  );
  return { items: data.items.map(toCertificate), total: data.total };
}

export async function getCertificateViewUrl(id: string) {
  return request<{
    url: string;
    expires_in: number;
    file_name: string;
    content_type: string;
  }>(`/api/certificates/${encodeURIComponent(id)}/view-url`);
}

export async function deleteCertificate(id: string) {
  await request<void>(`/api/certificates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadCertificateFile(opts: {
  file: File;
  equipmentId: string;
  calibrationId?: string;
}): Promise<AppCertificate> {
  const { file, equipmentId, calibrationId } = opts;
  if (file.type && file.type !== "application/pdf") {
    throw new ApiError("Only PDF documents are supported", 400);
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new ApiError("Only PDF documents are supported", 400);
  }
  if (file.size > CERTIFICATE_MAX_BYTES) {
    throw new ApiError("File exceeds the 2 MB size limit", 400);
  }
  if (file.size <= 0) {
    throw new ApiError("File is empty", 400);
  }

  // Upload via API → R2 so the browser never needs R2 CORS.
  const form = new FormData();
  form.append("equipment_id", equipmentId);
  if (calibrationId) form.append("calibration_id", calibrationId);
  form.append("file", file, file.name);

  const token = typeof window !== "undefined" ? getToken() : null;
  const res = await fetch(`${API_URL}/api/certificates/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      const ok = await tryRefresh();
      if (ok) return uploadCertificateFile(opts);
      clearToken();
      if (!window.location.pathname.startsWith("/auth")) {
        window.location.href = "/auth/login";
      }
    }
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => d.msg ?? JSON.stringify(d)).join(", ");
    } catch {
      /* ignore */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  const row = (await res.json()) as ApiCertificate;
  return toCertificate(row);
}

export type UserRole = "platform_admin" | "admin" | "qa" | "technician" | "member";
export type OrgUserRole = "admin" | "qa" | "technician" | "member";

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  job_title: string;
  department: string;
  phone: string;
  role: UserRole;
  timezone: string;
  locale: string;
  notify_email: boolean;
  notify_in_app: boolean;
  active?: boolean;
  tenant_id?: number | null;
  tenant_name?: string;
  tenant_slug?: string;
  storage_enabled?: boolean;
  storage_used_bytes?: number;
  storage_quota_bytes?: number;
  updated_at?: string | null;
  profile_setup_at?: string | null;
  product_tour_at?: string | null;
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_in?: number;
  user: AuthUser;
  tenant_id: number;
  tenant_name: string;
  tenant_slug: string;
}

export interface TenantItem {
  id: number;
  slug: string;
  name: string;
  active: boolean;
  created_at?: string | null;
}

export interface OrgProfileApi {
  company_name: string;
  industry: string;
  address: string;
  timezone: string;
  accent_color: string;
}

export interface OrgTaxonomyApi {
  departments: string[];
  categories: string[];
  locations: string[];
}

export interface ReminderRulesApi {
  remind_30d: boolean;
  remind_14d: boolean;
  remind_7d: boolean;
  remind_1d: boolean;
  remind_overdue_daily: boolean;
  remind_weekly_digest: boolean;
  reminder_hour_local: number;
  last_daily_run_at?: string | null;
}

export interface AppNotificationApi {
  id: string;
  type: string;
  title: string;
  body: string;
  when: string | null;
  read: boolean;
  equipment_id: string | null;
  created_at?: string | null;
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
}

export async function getAuthStatus() {
  return request<{ has_users: boolean }>("/api/auth/status");
}

export async function login(email: string, password: string) {
  return request<AuthSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  try {
    await request<void>("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  clearToken();
}

export async function exchangeHandoffCode(code: string) {
  return request<AuthSession>("/api/auth/handoff/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function register(payload: {
  email: string;
  password: string;
  full_name?: string;
  company_name?: string;
}) {
  return request<AuthSession>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getMe() {
  return request<AuthUser & { tenant_id: number; tenant_name: string; tenant_slug: string }>("/api/auth/me");
}

export async function listTenants() {
  return request<{ items: TenantItem[]; total: number }>("/api/tenants");
}

export async function createTenant(payload: {
  name: string;
  slug?: string;
  admin_email?: string;
  admin_password?: string;
  admin_full_name?: string;
}) {
  return request<TenantItem>("/api/tenants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function switchTenant(tenantId: number) {
  return request<AuthSession>(`/api/tenants/${tenantId}/switch`, { method: "POST" });
}

export async function updateMe(payload: Partial<{
  full_name: string;
  email: string;
  job_title: string;
  department: string;
  phone: string;
  timezone: string;
  locale: string;
  notify_email: boolean;
  notify_in_app: boolean;
  password: string;
  current_password: string;
  mark_profile_setup: boolean;
}>) {
  return request<AuthUser>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function completeProductTour(skipped = false) {
  return request<AuthUser>("/api/auth/onboarding/tour-complete", {
    method: "POST",
    body: JSON.stringify({ skipped }),
  });
}

export async function resetProductTour() {
  return request<AuthUser>("/api/auth/onboarding/tour-reset", {
    method: "POST",
  });
}

export async function getOrgProfile() {
  return request<OrgProfileApi>("/api/org");
}

export async function saveOrgProfileApi(payload: OrgProfileApi) {
  return request<OrgProfileApi>("/api/org", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getOrgTaxonomy() {
  return request<OrgTaxonomyApi>("/api/org/taxonomy");
}

export type OrgTaxonomyKind = keyof OrgTaxonomyApi;

export async function saveOrgTaxonomyApi(payload: OrgTaxonomyApi) {
  return request<OrgTaxonomyApi>("/api/org/taxonomy", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function addOrgTaxonomyTerm(kind: OrgTaxonomyKind, value: string) {
  return request<OrgTaxonomyApi>("/api/org/taxonomy/terms", {
    method: "POST",
    body: JSON.stringify({ kind, value }),
  });
}

export async function renameOrgTaxonomyTerm(
  kind: OrgTaxonomyKind,
  fromValue: string,
  toValue: string,
) {
  return request<OrgTaxonomyApi>("/api/org/taxonomy/terms", {
    method: "PATCH",
    body: JSON.stringify({ kind, from: fromValue, to: toValue }),
  });
}

export async function deleteOrgTaxonomyTerm(kind: OrgTaxonomyKind, value: string) {
  const q = new URLSearchParams({ kind, value });
  return request<OrgTaxonomyApi>(`/api/org/taxonomy/terms?${q}`, {
    method: "DELETE",
  });
}

export async function importOrgTaxonomyFromEquipment() {
  return request<OrgTaxonomyApi>("/api/org/taxonomy/import-equipment", {
    method: "POST",
  });
}

export async function getReminderRules() {
  return request<ReminderRulesApi>("/api/org/reminder-rules");
}

export async function saveReminderRules(payload: Omit<ReminderRulesApi, "last_daily_run_at">) {
  return request<ReminderRulesApi>("/api/org/reminder-rules", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export interface ReminderJobApi {
  id: number;
  job_kind: string;
  job_date_local: string;
  status: string;
  attempts: number;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
}

export interface ReminderSendApi {
  kind: string;
  channel: string;
  status: string;
  subject: string;
  recipient_key: string;
  recipient_name?: string;
  recipient_email?: string;
  equipment_count: number;
  sent_at?: string | null;
  error?: string | null;
}

export interface ReminderLogApi {
  jobs: ReminderJobApi[];
  sends: ReminderSendApi[];
  jobs_total: number;
  sends_total: number;
}

export async function getReminderLogs(
  limit = 50,
  filters?: {
    q?: string;
    channel?: string;
    kind?: string;
    status?: string;
    from_date?: string;
    to_date?: string;
  },
) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (filters?.q?.trim()) params.set("q", filters.q.trim());
  if (filters?.channel) params.set("channel", filters.channel);
  if (filters?.kind) params.set("kind", filters.kind);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.from_date) params.set("from_date", filters.from_date);
  if (filters?.to_date) params.set("to_date", filters.to_date);
  return request<ReminderLogApi>(`/api/org/reminder-logs?${params.toString()}`);
}

export async function listNotifications() {
  return request<{ items: AppNotificationApi[]; total: number; unread: number }>("/api/notifications");
}

export async function markAllNotificationsRead() {
  return request<{ items: AppNotificationApi[]; total: number; unread: number }>(
    "/api/notifications/mark-all-read",
    { method: "POST" },
  );
}

export async function markNotificationRead(id: string) {
  return request<AppNotificationApi>(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  });
}

export async function listEmailHistory(limit = 100) {
  return request<{ items: EmailAuditItem[]; total: number }>(`/api/email/history?limit=${limit}`);
}

export interface AuditEventApi {
  id: string;
  user_name: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  target_name: string;
  detail: string;
  timestamp: string;
}

export async function listAuditEvents(limit = 40) {
  return request<{ items: AuditEventApi[]; total: number }>(`/api/audit?limit=${limit}`);
}

export type ReportType = "inventory" | "overdue" | "due" | "compliance";
export type ReportFormat = "csv" | "pdf";

/** Download a generated report file (CSV or PDF) from the API. */
export async function downloadReport(opts: {
  type: ReportType;
  format: ReportFormat;
}): Promise<{ filename: string; rowCount: number }> {
  const sp = new URLSearchParams({ type: opts.type, format: opts.format });
  const path = `/api/reports/download?${sp.toString()}`;

  const doFetch = async () => {
    const token = typeof window !== "undefined" ? getToken() : null;
    return fetch(`${API_URL}${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  let res = await doFetch();
  if (res.status === 401) {
    const ok = await tryRefresh();
    if (ok) res = await doFetch();
    else {
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
        window.location.href = "/auth/login";
      }
      throw new ApiError("Session expired — please sign in again", 401);
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail || `Download failed (${res.status})`, res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/i.exec(disposition);
  const filename =
    match?.[1] ||
    `TrueGage-${opts.type}.${opts.format === "pdf" ? "pdf" : "csv"}`;
  const rowCount = Number(res.headers.get("X-Report-Rows") || "0");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  return { filename, rowCount };
}

export type AdminUserCreatePayload = {
  email: string;
  password: string;
  full_name?: string;
  role?: UserRole;
  job_title?: string;
  department?: string;
  send_credentials?: boolean;
};

export type AdminUserUpdatePayload = {
  email?: string;
  full_name?: string;
  role?: UserRole;
  job_title?: string;
  department?: string;
  active?: boolean;
  password?: string;
};

export async function listUsers() {
  return request<{ items: AuthUser[]; total: number }>("/api/users");
}

export async function createUser(payload: AdminUserCreatePayload) {
  return request<AuthUser>("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUser(id: number, payload: AdminUserUpdatePayload) {
  return request<AuthUser>(`/api/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(id: number) {
  await request<void>(`/api/users/${id}`, { method: "DELETE" });
}

export async function revokeUserSessions(id: number) {
  return request<AuthUser>(`/api/users/${id}/revoke-sessions`, { method: "POST" });
}

export async function sendUserCredentials(id: number, password: string) {
  return request<AuthUser>(`/api/users/${id}/send-credentials`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export { API_URL };
