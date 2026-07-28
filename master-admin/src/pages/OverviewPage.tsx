import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getOverview, getPlatformHealth } from "@/lib/api";

function shortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: getOverview,
  });
  const health = useQuery({
    queryKey: ["platform-health"],
    queryFn: getPlatformHealth,
  });

  const onboardSeries =
    data?.onboardings_by_day.map((d) => ({
      label: shortDate(d.date),
      onboardings: d.count ?? 0,
    })) ?? [];
  const emailSeries =
    data?.emails_by_day.map((d) => ({
      label: shortDate(d.date),
      sent: d.sent ?? 0,
      failed: d.failed ?? 0,
    })) ?? [];
  const authSeries =
    data?.auth_by_day.map((d) => ({
      label: shortDate(d.date),
      ok: d.ok ?? 0,
      fail: d.fail ?? 0,
    })) ?? [];

  return (
    <div>
      <h1 className="page-title">Command Center</h1>
      <p className="page-sub">
        Onboarding ops hub — company provisioning, welcome delivery, staff activity, and platform health.
      </p>

      {error && <p className="error">{error instanceof Error ? error.message : "Failed to load"}</p>}
      {isLoading && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="status-strip">
            <span>
              System{" "}
              <strong className={data.system_status === "ok" ? "text-ok" : "text-danger"}>
                {data.system_status.toUpperCase()}
              </strong>
            </span>
            <span>
              Database{" "}
              <strong className={data.database_status === "up" ? "text-ok" : "text-danger"}>
                {data.database_status.toUpperCase()}
              </strong>
            </span>
            <span>
              Platform SMTP{" "}
              <Link to="/email">
                <strong className={data.system_smtp_ready ? "text-ok" : "text-warn"}>
                  {data.system_smtp_ready ? "READY" : "NOT SET"}
                </strong>
              </Link>
            </span>
            {health.data && (
              <span>
                Env <strong className="mono">{health.data.environment}</strong>
              </span>
            )}
          </div>

          {(data.attention_suspended > 0 ||
            data.attention_failed_welcomes_7d > 0 ||
            data.attention_active_without_smtp > 0 ||
            data.auth_failures_24h > 0) && (
            <div className="attention-strip">
              {data.attention_suspended > 0 && (
                <Link className="attention-chip" to="/companies">
                  Suspended <strong>{data.attention_suspended}</strong>
                </Link>
              )}
              {data.attention_failed_welcomes_7d > 0 && (
                <Link className="attention-chip" to="/email">
                  Failed welcomes (7d) <strong>{data.attention_failed_welcomes_7d}</strong>
                </Link>
              )}
              {data.attention_active_without_smtp > 0 && (
                <Link className="attention-chip" to="/companies">
                  Active without SMTP <strong>{data.attention_active_without_smtp}</strong>
                </Link>
              )}
              {data.auth_failures_24h > 0 && (
                <Link className="attention-chip" to="/activity">
                  Auth failures (24h) <strong>{data.auth_failures_24h}</strong>
                </Link>
              )}
            </div>
          )}

          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">Active companies</div>
              <div className="kpi-value">
                {data.active_tenant_count}
                <span className="kpi-suffix">/ {data.tenant_count}</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Onboarded (30d)</div>
              <div className="kpi-value">{data.onboardings_30d}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Org users</div>
              <div className="kpi-value">{data.user_count}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">TrueGage staff</div>
              <div className="kpi-value">{data.staff_count}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Email sent (7d)</div>
              <div className="kpi-value">{data.email_7d_sent}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Email failed (7d)</div>
              <div className="kpi-value">{data.email_7d_failed}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">SMTP / Odoo ready</div>
              <div className="kpi-value">
                {data.smtp_configured_tenants}
                <span className="kpi-suffix">/ {data.odoo_configured_tenants}</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Auth events (24h)</div>
              <div className="kpi-value">
                {data.auth_events_24h}
                <span className="kpi-suffix fail">· {data.auth_failures_24h} fail</span>
              </div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="panel chart-panel">
              <div className="panel-head">
                <h2>Company onboardings</h2>
                <span className="muted">Last 14 days</span>
              </div>
              <div className="chart-body">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={onboardSeries}>
                    <CartesianGrid stroke="rgba(42,56,62,0.7)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#8fa3aa", fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#8fa3aa", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141c1f",
                        border: "1px solid #2a383e",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="onboardings" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel chart-panel">
              <div className="panel-head">
                <h2>Outbound email</h2>
                <span className="muted">Sent vs failed</span>
              </div>
              <div className="chart-body">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={emailSeries}>
                    <CartesianGrid stroke="rgba(42,56,62,0.7)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#8fa3aa", fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#8fa3aa", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141c1f",
                        border: "1px solid #2a383e",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="sent" stroke="#4ade80" fill="rgba(74,222,128,0.2)" />
                    <Area type="monotone" dataKey="failed" stroke="#f87171" fill="rgba(248,113,113,0.15)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel chart-panel">
              <div className="panel-head">
                <h2>Auth / staff actions</h2>
                <span className="muted">OK vs fail</span>
              </div>
              <div className="chart-body">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={authSeries}>
                    <CartesianGrid stroke="rgba(42,56,62,0.7)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#8fa3aa", fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#8fa3aa", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#141c1f",
                        border: "1px solid #2a383e",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="ok" stroke="#2dd4bf" fill="rgba(45,212,191,0.18)" />
                    <Area type="monotone" dataKey="fail" stroke="#fbbf24" fill="rgba(251,191,36,0.12)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Recent companies</h2>
              <div className="row">
                <Link className="btn btn-ghost" to="/activity">
                  Activity
                </Link>
                <Link className="btn btn-ghost" to="/companies">
                  View all
                </Link>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Users</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_tenants.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/companies/${t.id}`}>{t.name}</Link>
                      <div className="mono muted" style={{ fontSize: "0.75rem" }}>
                        {t.slug}
                      </div>
                    </td>
                    <td className="mono">{t.user_count}</td>
                    <td className="muted">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      <span className={`badge ${t.active ? "badge-ok" : "badge-off"}`}>
                        {t.active ? "Active" : "Suspended"}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.recent_tenants.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
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
