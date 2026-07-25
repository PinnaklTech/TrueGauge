import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { APP_URL, getTenant, switchTenant, updateTenant } from "@/lib/api";

export function CompanyDetailPage() {
  const { id } = useParams();
  const tenantId = Number(id);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => getTenant(tenantId),
    enabled: Number.isFinite(tenantId),
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [opening, setOpening] = useState(false);

  const saveMut = useMutation({
    mutationFn: (payload: { name?: string; active?: boolean }) => updateTenant(tenantId, payload),
    onSuccess: async () => {
      setEditing(false);
      setMsg("Saved");
      await queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const openCompany = async () => {
    setOpening(true);
    setMsg("");
    try {
      const session = await switchTenant(tenantId);
      const url = `${APP_URL}/auth/handoff#token=${encodeURIComponent(session.access_token)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not open company");
    } finally {
      setOpening(false);
    }
  };

  if (!Number.isFinite(tenantId)) {
    return <p className="error">Invalid company id</p>;
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/companies">← Companies</Link>
      </p>
      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error instanceof Error ? error.message : "Failed"}</p>}

      {data && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>
                {data.name}
              </h1>
              <p className="page-sub" style={{ marginBottom: 0 }}>
                <span className="mono">{data.slug}</span>
                {" · "}
                <span className={`badge ${data.active ? "badge-ok" : "badge-off"}`}>
                  {data.active ? "Active" : "Inactive"}
                </span>
              </p>
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={opening || !data.active} onClick={() => void openCompany()}>
                {opening ? "Opening…" : "Open company"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(true);
                  setName(data.name);
                  setMsg("");
                }}
              >
                Edit name
              </button>
              <button
                type="button"
                className={data.active ? "btn btn-danger" : "btn btn-primary"}
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate({ active: !data.active })}
              >
                {data.active ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
          {msg && <p className={msg === "Saved" ? "muted" : "error"}>{msg}</p>}

          <div className="kpi-grid" style={{ marginTop: "1.25rem" }}>
            <div className="kpi">
              <div className="kpi-label">Users</div>
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
            <div className="kpi">
              <div className="kpi-label">Timezone</div>
              <div className="kpi-value" style={{ fontSize: "1.1rem" }}>
                {data.timezone}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Organization profile</h2>
            </div>
            <div style={{ padding: "1rem 1.1rem" }}>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="label">Company name</div>
                  <div>{data.company_name || "—"}</div>
                </div>
                <div className="detail-item">
                  <div className="label">Industry</div>
                  <div>{data.industry || "—"}</div>
                </div>
                <div className="detail-item" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">Address</div>
                  <div>{data.address || "—"}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {editing && data && (
        <div className="dialog-backdrop" onClick={() => !saveMut.isPending && setEditing(false)}>
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveMut.mutate({ name: name.trim() });
            }}
          >
            <h3>Rename company</h3>
            <p>Updates the workspace display name.</p>
            <div className="field">
              <label htmlFor="rename">Name</label>
              <input id="rename" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saveMut.isPending}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
