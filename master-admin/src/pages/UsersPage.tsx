import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listPlatformUsers, type PlatformUser } from "@/lib/api";

type CompanyGroup = {
  key: string;
  tenantId: number | null;
  name: string;
  users: PlatformUser[];
};

function groupByCompany(users: PlatformUser[]): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();
  for (const u of users) {
    const tenantId = u.tenant_id ?? null;
    const key = tenantId != null ? `t-${tenantId}` : "unassigned";
    const existing = map.get(key);
    if (existing) {
      existing.users.push(u);
    } else {
      map.set(key, {
        key,
        tenantId,
        name: tenantId != null ? u.tenant_name || `Company #${tenantId}` : "No company",
        users: [u],
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
    g.users.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
  }
  return groups;
}

export function UsersPage() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-users", search],
    queryFn: () => listPlatformUsers(search),
  });

  const groups = useMemo(() => groupByCompany(data?.items ?? []), [data?.items]);

  return (
    <div>
      <h1 className="page-title">All users</h1>
      <p className="page-sub">
        Users grouped by company. Open a company to force-reset passwords or manage membership.
      </p>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <input
          placeholder="Search email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <button type="submit" className="btn btn-ghost">
          Search
        </button>
      </form>

      {error && <p className="error">{error instanceof Error ? error.message : "Failed"}</p>}
      {isLoading && <p className="muted">Loading…</p>}

      {data && groups.length === 0 && <p className="muted">No users found.</p>}

      {data && groups.length > 0 && (
        <>
          <div className="muted" style={{ marginBottom: "0.85rem", fontSize: "0.85rem" }}>
            {data.total} users · {groups.length}{" "}
            {groups.length === 1 ? "company" : "companies"}
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
                    {group.users.length} {group.users.length === 1 ? "user" : "users"}
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.full_name || "—"}</td>
                        <td className="mono">{u.email}</td>
                        <td className="mono">{u.role}</td>
                        <td>
                          <span className={`badge ${u.active ? "badge-ok" : "badge-off"}`}>
                            {u.active ? "Active" : "Disabled"}
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
