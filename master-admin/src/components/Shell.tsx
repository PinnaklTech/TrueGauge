import { Navigate, Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { API_URL, getMe } from "@/lib/api";
import { clearToken, getToken, isAuthenticated } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

async function signOut(navigate: (path: string) => void) {
  try {
    const token = getToken();
    if (token) {
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
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  return (
    <div className={navOpen ? "app-shell nav-open" : "app-shell"}>
      {navOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside className="sidebar" aria-label="Staff navigation">
        <button
          type="button"
          className="sidebar-close"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        >
          ✕
        </button>
        <div className="brand">
          <div className="brand-kicker">TrueGage · Restricted</div>
          <div className="brand-title">Staff Console</div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Command Center
          </NavLink>
          <NavLink to="/companies">Companies</NavLink>
          <NavLink to="/users">Users</NavLink>
          <NavLink to="/staff">Staff</NavLink>
          <NavLink to="/email">Email</NavLink>
          <NavLink to="/activity">Activity</NavLink>
          <NavLink to="/data">Data</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">{me?.full_name || me?.email || "…"}</div>
          <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
            Platform admin
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: "0.5rem", width: "100%" }}
            onClick={() => void signOut((path) => void navigate(path))}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="mobile-topbar">
          <button
            type="button"
            className="menu-btn"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <span aria-hidden style={{ fontSize: "1.1rem", lineHeight: 1 }}>
              ☰
            </span>
          </button>
          <div className="mobile-topbar-brand">
            <div className="mobile-topbar-kicker">TrueGage · Staff</div>
            <div className="mobile-topbar-title">Staff Console</div>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
