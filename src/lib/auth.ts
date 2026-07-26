const ACCESS_KEY = "tg-access-token";
const REFRESH_KEY = "tg-refresh-token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(ACCESS_KEY, token);
}

export function setSessionTokens(accessToken: string, refreshToken?: string | null) {
  localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }
}

export function clearToken() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}
