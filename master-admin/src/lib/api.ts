import { clearToken, getToken } from "@/lib/auth";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      clearToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role: string;
  tenant_id?: number | null;
}

export interface AuthSession {
  access_token: string;
  user: AuthUser;
  tenant_id: number;
  tenant_name: string;
}

export interface TenantItem {
  id: number;
  slug: string;
  name: string;
  active: boolean;
  created_at?: string | null;
  user_count: number;
  equipment_count: number;
  overdue_count: number;
}

export interface TenantDetail extends TenantItem {
  company_name: string;
  industry: string;
  address: string;
  timezone: string;
  accent_color: string;
}

export interface PlatformOverview {
  tenant_count: number;
  user_count: number;
  equipment_count: number;
  overdue_count: number;
  recent_tenants: TenantItem[];
}

export async function login(email: string, password: string) {
  const session = await request<AuthSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (session.user.role !== "platform_admin") {
    throw new ApiError("Master Admin is for True Gauge platform admins only", 403);
  }
  return session;
}

export async function getMe() {
  return request<AuthUser & { tenant_id: number; tenant_name: string }>("/api/auth/me");
}

export async function getOverview() {
  return request<PlatformOverview>("/api/platform/overview");
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
  admin_email?: string;
  admin_password?: string;
  admin_full_name?: string;
}) {
  return request<TenantItem>("/api/tenants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTenant(id: number, payload: { name?: string; active?: boolean }) {
  return request<TenantDetail>(`/api/tenants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function switchTenant(id: number) {
  return request<AuthSession>(`/api/tenants/${id}/switch`, { method: "POST" });
}
