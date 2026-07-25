import { Navigate, Outlet, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api";
import { clearToken, isAuthenticated } from "@/lib/auth";

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
          <div className="brand-kicker">True Gauge</div>
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
            onClick={() => {
              clearToken();
              void navigate("/login");
            }}
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
