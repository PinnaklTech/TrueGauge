import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createStaff, listStaff, type PlatformUser, updateStaff } from "@/lib/api";

export function StaffPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["staff"],
    queryFn: listStaff,
  });
  const [open, setOpen] = useState(false);
  const [editUser, setEditUser] = useState<PlatformUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [editName, setEditName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [formError, setFormError] = useState("");

  const createMut = useMutation({
    mutationFn: createStaff,
    onSuccess: async () => {
      setOpen(false);
      setEmail("");
      setPassword("");
      setFullName("");
      setFormError("");
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => updateStaff(id, { active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
  });

  const editMut = useMutation({
    mutationFn: () =>
      updateStaff(editUser!.id, {
        full_name: editName.trim(),
        ...(editPassword.length >= 12 ? { password: editPassword } : {}),
      }),
    onSuccess: async () => {
      setEditUser(null);
      setEditPassword("");
      setFormError("");
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || password.length < 12) {
      setFormError("Email and password (min 12) are required");
      return;
    }
    createMut.mutate({
      email: email.trim(),
      password,
      full_name: fullName.trim() || undefined,
    });
  };

  return (
    <div>
      <h1 className="page-title">TrueGage staff</h1>
      <p className="page-sub">
        Platform admins who can sign into this Staff Console with the shared passcode. Create additional staff
        accounts for your team.
      </p>

      <div className="panel">
        <div className="panel-head">
          <h2>Staff accounts</h2>
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Add staff admin
          </button>
        </div>
        {error && (
          <p className="error" style={{ padding: "0.75rem 1.1rem" }}>
            {error instanceof Error ? error.message : "Failed"}
          </p>
        )}
        {isLoading && (
          <p className="muted" style={{ padding: "0.75rem 1.1rem" }}>
            Loading…
          </p>
        )}
        {data && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Created</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name || "—"}</td>
                  <td className="mono">{u.email}</td>
                  <td className="muted">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    <span className={`badge ${u.active ? "badge-ok" : "badge-off"}`}>
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setEditUser(u);
                          setEditName(u.full_name || "");
                          setEditPassword("");
                          setFormError("");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={toggleMut.isPending}
                        onClick={() => toggleMut.mutate({ id: u.id, active: !u.active })}
                      >
                        {u.active ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="dialog-backdrop" onClick={() => !createMut.isPending && setOpen(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={onCreate}>
            <h3>Add staff admin</h3>
            <p>Creates a platform_admin who can access the Staff Console.</p>
            {formError && <p className="error">{formError}</p>}
            <div className="field">
              <label htmlFor="st-name">Full name</label>
              <input id="st-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="st-email">Email</label>
              <input
                id="st-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="st-pw">Password (min 12)</label>
              <input
                id="st-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {editUser && (
        <div className="dialog-backdrop" onClick={() => !editMut.isPending && setEditUser(null)}>
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (editPassword && editPassword.length < 12) {
                setFormError("Password must be at least 12 characters");
                return;
              }
              editMut.mutate();
            }}
          >
            <h3>Edit staff</h3>
            <p className="mono muted">{editUser.email}</p>
            {formError && <p className="error">{formError}</p>}
            <div className="field">
              <label>Full name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="field">
              <label>New password (optional)</label>
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditUser(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={editMut.isPending}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
