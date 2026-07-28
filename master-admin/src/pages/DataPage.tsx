import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDataSummary, getDataTable } from "@/lib/api";

const TABLES = [
  { id: "tenants", label: "Companies" },
  { id: "users", label: "Users" },
  { id: "equipment", label: "Equipment" },
  { id: "calibrations", label: "Calibrations" },
  { id: "email_audits", label: "Email audit" },
  { id: "auth_events", label: "Auth events" },
  { id: "notifications", label: "Notifications" },
] as const;

export function DataPage() {
  const [table, setTable] = useState<(typeof TABLES)[number]["id"]>("tenants");
  const [page, setPage] = useState(0);
  const limit = 40;

  const summary = useQuery({
    queryKey: ["data-summary"],
    queryFn: getDataSummary,
  });
  const rows = useQuery({
    queryKey: ["data-table", table, page],
    queryFn: () => getDataTable(table, limit, page * limit),
  });

  const s = summary.data;

  return (
    <div>
      <h1 className="page-title">Data browser</h1>
      <p className="page-sub">
        Read-only ops view across the live database. Secrets (password hashes, encrypted SMTP/Odoo keys) are
        redacted. Use company tools for mutations.
      </p>

      {summary.error && (
        <p className="error">{summary.error instanceof Error ? summary.error.message : "Failed"}</p>
      )}

      {s && (
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-label">Companies</div>
            <div className="kpi-value">{s.tenants}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Org users</div>
            <div className="kpi-value">{s.users}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Staff</div>
            <div className="kpi-value">{s.staff}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Equipment</div>
            <div className="kpi-value">{s.equipment}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Calibrations</div>
            <div className="kpi-value">{s.calibrations}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Email audits</div>
            <div className="kpi-value">{s.email_audits}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Auth events</div>
            <div className="kpi-value">{s.auth_events}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Notifications</div>
            <div className="kpi-value">{s.notifications}</div>
          </div>
        </div>
      )}

      <div className="tabs">
        {TABLES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${table === t.id ? "tab-active" : ""}`}
            onClick={() => {
              setTable(t.id);
              setPage(0);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rows.error && <p className="error">{rows.error instanceof Error ? rows.error.message : "Failed"}</p>}
      {rows.isLoading && <p className="muted">Loading…</p>}

      {rows.data && (
        <div className="panel">
          <div className="panel-head">
            <h2>{TABLES.find((t) => t.id === table)?.label}</h2>
            <div className="row">
              <span className="muted mono">
                {rows.data.offset + 1}–{Math.min(rows.data.offset + rows.data.rows.length, rows.data.total)} of{" "}
                {rows.data.total}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={(page + 1) * limit >= rows.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {rows.data.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.rows.map((row, idx) => (
                  <tr key={String(row.id ?? idx)}>
                    {rows.data.columns.map((c) => (
                      <td key={c} className="mono" style={{ fontSize: "0.78rem", maxWidth: 220 }}>
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(rows.data.columns.length, 1)} className="muted">
                      Empty table.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}
