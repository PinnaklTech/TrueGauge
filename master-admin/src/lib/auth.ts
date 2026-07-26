const ACCESS_KEY = "tg-master-token";
const REFRESH_KEY = "tg-master-refresh";

export function getToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
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
