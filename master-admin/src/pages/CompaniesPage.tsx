import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createTenant, listTenants } from "@/lib/api";

export function CompaniesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenants"],
    queryFn: listTenants,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [formError, setFormError] = useState("");

  const createMut = useMutation({
    mutationFn: createTenant,
    onSuccess: async () => {
      setOpen(false);
      setName("");
      setSlug("");
      setAdminEmail("");
      setAdminPassword("");
      setAdminFullName("");
      setFormError("");
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Company name is required");
      return;
    }
    createMut.mutate({
      name: name.trim(),
      slug: slug.trim() || undefined,
      admin_email: adminEmail.trim() || undefined,
      admin_password: adminPassword || undefined,
      admin_full_name: adminFullName.trim() || undefined,
    });
  };

  return (
    <div>
      <h1 className="page-title">Companies</h1>
      <p className="page-sub">Create and open customer workspaces.</p>

      <div className="panel">
        <div className="panel-head">
          <h2>All companies</h2>
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            New company
          </button>
        </div>
        {error && <p className="error" style={{ padding: "0.75rem 1.1rem" }}>{error instanceof Error ? error.message : "Failed"}</p>}
        {isLoading && <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>Loading…</p>}
        {data && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Users</th>
                <th>Equipment</th>
                <th>Overdue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/companies/${t.id}`}>{t.name}</Link>
                  </td>
                  <td className="mono muted">{t.slug}</td>
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
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No companies yet. Create the first workspace.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="dialog-backdrop" onClick={() => !createMut.isPending && setOpen(false)}>
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void onCreate(e)}
          >
            <h3>New company</h3>
            <p>Creates an isolated customer workspace. Optionally add the first org admin.</p>
            {formError && <p className="error">{formError}</p>}
            <div className="field">
              <label htmlFor="name">Company name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="slug">Slug (optional)</label>
              <input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-metrology" />
            </div>
            <div className="field">
              <label htmlFor="admin-name">Admin full name (optional)</label>
              <input id="admin-name" value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="admin-email">Admin email (optional)</label>
              <input id="admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="admin-password">Admin password (optional)</label>
              <input
                id="admin-password"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={createMut.isPending}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
                {createMut.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
