import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getOverview } from "@/lib/api";

export function OverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: getOverview,
  });

  return (
    <div>
      <h1 className="page-title">Overview</h1>
      <p className="page-sub">Cross-company snapshot for workspaces you can access.</p>

      {error && <p className="error">{error instanceof Error ? error.message : "Failed to load"}</p>}
      {isLoading && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">Companies</div>
              <div className="kpi-value">{data.tenant_count}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Org users</div>
              <div className="kpi-value">{data.user_count}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Equipment</div>
              <div className="kpi-value">{data.equipment_count}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Overdue</div>
              <div className="kpi-value">{data.overdue_count}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Recent companies</h2>
              <Link className="btn btn-ghost" to="/companies">
                View all
              </Link>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Users</th>
                  <th>Equipment</th>
                  <th>Overdue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_tenants.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/companies/${t.id}`}>{t.name}</Link>
                    </td>
                    <td className="mono">{t.user_count}</td>
                    <td className="mono">{t.equipment_count}</td>
                    <td className="mono">{t.overdue_count}</td>
                    <td>
                      <span className={`badge ${t.active ? "badge-ok" : "badge-off"}`}>
                        {t.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.recent_tenants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No companies yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
