import { clearToken, getRefreshToken, getToken, setSessionTokens } from "@/lib/auth";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

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

export async function createHandoffCode(id: number) {
  return request<{ code: string; expires_in: number }>(`/api/tenants/${id}/handoff`, {
    method: "POST",
  });
}
