import { Navigate, Outlet, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api";
import { clearToken, getToken, isAuthenticated } from "@/lib/auth";

async function signOut(navigate: (path: string) => void) {
  try {
    const token = getToken();
    if (token) {
      const API_URL =
        (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ||
        "http://localhost:8000";
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    /* ignore */
  }
  clearToken();
  navigate("/login");
}

export function RequireAuth() {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function Shell() {
  const navigate = useNavigate();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-kicker">TrueGage</div>
          <div className="brand-title">Master Admin</div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/companies">Companies</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div>{me?.full_name || me?.email || "…"}</div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: "0.65rem", width: "100%" }}
            onClick={() => void signOut((path) => void navigate(path))}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
