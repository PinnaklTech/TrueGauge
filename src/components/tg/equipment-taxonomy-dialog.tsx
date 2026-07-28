import { useEffect, useState } from "react";
import {
  addOrgTaxonomyTerm,
  deleteOrgTaxonomyTerm,
  getOrgTaxonomy,
  importOrgTaxonomyFromEquipment,
  renameOrgTaxonomyTerm,
  type OrgTaxonomyApi,
  type OrgTaxonomyKind,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const empty: OrgTaxonomyApi = { departments: [], categories: [], locations: [] };

const columns: Array<{ key: OrgTaxonomyKind; title: string; hint: string }> = [
  { key: "departments", title: "Departments", hint: "Used on equipment and profiles" },
  { key: "categories", title: "Categories", hint: "Equipment type / gauge family" },
  { key: "locations", title: "Locations", hint: "Where equipment is kept or used" },
];

export function EquipmentTaxonomyDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful change so forms/filters can refresh. */
  onChanged?: (taxonomy: OrgTaxonomyApi) => void;
}) {
  const [taxonomy, setTaxonomy] = useState<OrgTaxonomyApi>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState({ departments: "", categories: "", locations: "" });
  const [editing, setEditing] = useState<{ kind: OrgTaxonomyKind; value: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await getOrgTaxonomy();
      setTaxonomy(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load registers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setDrafts({ departments: "", categories: "", locations: "" });
    void load();
  }, [open]);

  const apply = (next: OrgTaxonomyApi) => {
    setTaxonomy(next);
    onChanged?.(next);
  };

  const addTerm = async (key: OrgTaxonomyKind) => {
    const value = drafts[key].trim();
    if (!value) {
      toast.error("Enter a name to add");
      return;
    }
    setBusy(true);
    try {
      const saved = await addOrgTaxonomyTerm(key, value);
      setDrafts((d) => ({ ...d, [key]: "" }));
      apply(saved);
      toast.success("Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (kind: OrgTaxonomyKind, value: string) => {
    setEditing({ kind, value });
    setEditDraft(value);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const next = editDraft.trim();
    if (!next) {
      toast.error("Name cannot be empty");
      return;
    }
    if (next === editing.value) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      const saved = await renameOrgTaxonomyTerm(editing.kind, editing.value, next);
      apply(saved);
      setEditing(null);
      toast.success("Updated — matching equipment was renamed too");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename");
    } finally {
      setBusy(false);
    }
  };

  const removeTerm = async (key: OrgTaxonomyKind, term: string) => {
    setBusy(true);
    try {
      const saved = await deleteOrgTaxonomyTerm(key, term);
      apply(saved);
      if (editing?.kind === key && editing.value === term) setEditing(null);
      toast.success("Removed from list");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setBusy(true);
    try {
      const merged = await importOrgTaxonomyFromEquipment();
      apply(merged);
      toast.success("Imported values from existing equipment");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Keep Lists open while the product tour is walking through it
        if (
          !next &&
          typeof window !== "undefined" &&
          sessionStorage.getItem("tg-tour-running") === "1" &&
          document.body.classList.contains("tg-tour-lists-expanded")
        ) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        data-tour="equipment-lists-dialog"
      >
        <DialogHeader>
          <DialogTitle>Departments, categories & locations</DialogTitle>
          <DialogDescription>
            Create and edit the lists used when adding or updating equipment. Renaming updates
            matching equipment records.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => void onImport()} disabled={busy || loading}>
            Import from equipment
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {columns.map(({ key, title, hint }, colIndex) => (
              <div
                key={key}
                className="rounded-xl border border-border bg-card shadow-xs"
                data-tour={colIndex === 0 ? "equipment-lists-panel" : undefined}
              >
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
                </div>
                <div
                  className="flex gap-2 border-b border-border px-3 py-2"
                  data-tour={colIndex === 0 ? "equipment-lists-add" : undefined}
                >
                  <Input
                    value={drafts[key]}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    placeholder={`Add ${title.slice(0, -1).toLowerCase()}…`}
                    className="h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addTerm(key);
                      }
                    }}
                    disabled={busy}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void addTerm(key)}
                    disabled={busy}
                  >
                    + Add
                  </Button>
                </div>
                <ul
                  className="max-h-64 divide-y divide-border overflow-y-auto text-sm"
                  data-tour={colIndex === 0 ? "equipment-lists-actions" : undefined}
                >
                  {taxonomy[key].length === 0 ? (
                    <li className="px-4 py-6 text-center text-muted-foreground">
                      No {title.toLowerCase()} yet.
                      <span className="mt-2 block text-[11px]">
                        Add your first {title.slice(0, -1).toLowerCase()} above.
                      </span>
                    </li>
                  ) : (
                    taxonomy[key].map((term) => (
                      <li key={term} className="flex items-center gap-1 px-3 py-2">
                        {editing?.kind === key && editing.value === term ? (
                          <>
                            <Input
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              className="h-8 min-w-0 flex-1"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveEdit();
                                }
                                if (e.key === "Escape") setEditing(null);
                              }}
                              disabled={busy}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 text-xs"
                              onClick={() => void saveEdit()}
                              disabled={busy}
                            >
                              Save
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 truncate text-foreground">{term}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
                              aria-label={`Rename ${term}`}
                              onClick={() => startEdit(key, term)}
                              disabled={busy}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Remove ${term}`}
                              onClick={() => void removeTerm(key, term)}
                              disabled={busy}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
