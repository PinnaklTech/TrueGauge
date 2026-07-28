import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getActivity, type ActivityItem } from "@/lib/api";

const TABS = [
  { id: "all", label: "All" },
  { id: "onboarding", label: "Onboarding" },
  { id: "email", label: "Email" },
  { id: "auth", label: "Auth & staff" },
  { id: "ops", label: "Company ops" },
] as const;

type CompanyGroup = {
  key: string;
  tenantId: number | null;
  name: string;
  items: ActivityItem[];
};

function groupByCompany(items: ActivityItem[]): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();
  for (const item of items) {
    const tenantId = item.tenant_id ?? null;
    const key = tenantId != null ? `t-${tenantId}` : "platform";
    const existing = map.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(key, {
        key,
        tenantId,
        name: tenantId != null ? item.tenant_name || `Company #${tenantId}` : "Platform / no company",
        items: [item],
      });
    }
  }
  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.tenantId == null) return 1;
    if (b.tenantId == null) return -1;
    return a.name.localeCompare(b.name);
  });
  for (const g of groups) {
    g.items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }
  return groups;
}

function statusBadge(status: string) {
  if (status === "ok" || status === "sent") return "badge-ok";
  if (status === "failed" || status === "denied") return "badge-off";
  return "badge-warn";
}

export function ActivityPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const { data, isLoading, error } = useQuery({
    queryKey: ["activity", tab],
    queryFn: () => getActivity(80, tab),
  });

  const groups = useMemo(() => groupByCompany(data?.items ?? []), [data?.items]);

  return (
    <div>
      <h1 className="page-title">Activity</h1>
      <p className="page-sub">
        Events filtered by type, then grouped by company — onboardings, emails, staff auth, and lifecycle
        actions.
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error instanceof Error ? error.message : "Failed"}</p>}
      {isLoading && <p className="muted">Loading…</p>}

      {data && groups.length === 0 && (
        <p className="muted">No events in this category yet.</p>
      )}

      {data && groups.length > 0 && (
        <>
          <div className="muted" style={{ marginBottom: "0.85rem", fontSize: "0.85rem" }}>
            {data.total} events · {groups.length}{" "}
            {groups.length === 1 ? "group" : "groups"} · {TABS.find((t) => t.id === tab)?.label}
          </div>
          <div className="company-user-groups">
            {groups.map((group) => (
              <div className="panel" key={group.key}>
                <div className="panel-head">
                  <h2>
                    {group.tenantId != null ? (
                      <Link to={`/companies/${group.tenantId}`}>{group.name}</Link>
                    ) : (
                      group.name
                    )}
                  </h2>
                  <span className="muted mono">
                    {group.items.length} {group.items.length === 1 ? "event" : "events"}
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Kind</th>
                      <th>Title</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id}>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="mono">{item.kind}</td>
                        <td>
                          <div>{item.title}</div>
                          {item.detail && (
                            <div className="muted" style={{ fontSize: "0.8rem" }}>
                              {item.detail}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${statusBadge(item.status)}`}>
                            {item.status || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
