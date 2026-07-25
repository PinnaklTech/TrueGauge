import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { StatusBadge } from "@/components/tg/status-badge";
import { EquipmentFormDialog } from "@/components/tg/equipment-form-dialog";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { statusLabel, type CalStatus } from "@/lib/mock-data";
import {
  createEquipment,
  deleteEquipment,
  listEquipment,
  updateEquipment,
  type AppEquipment,
  type EquipmentPayload,
} from "@/lib/api";
import { parseDate } from "@/lib/compliance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutGrid, List, Plus, Search, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { format, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";

type EquipmentSearch = {
  new?: true;
  status?: CalStatus;
};

const STATUS_VALUES = new Set<string>(Object.keys(statusLabel));

export const Route = createFileRoute("/equipment/")({
  head: () => ({ meta: [{ title: "Equipment · True Gauge" }] }),
  validateSearch: (search: Record<string, unknown>): EquipmentSearch => {
    const result: EquipmentSearch = {};
    const openCreate =
      search.new === true || search.new === "true" || search.new === "1";
    if (openCreate) result.new = true;
    if (typeof search.status === "string" && STATUS_VALUES.has(search.status)) {
      result.status = search.status as CalStatus;
    }
    return result;
  },
  component: EquipmentPage,
});

function EquipmentPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CalStatus | "all">(search.status ?? "all");
  const [department, setDepartment] = useState("all");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<"table" | "grid">("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AppEquipment | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (search.new) setCreateOpen(true);
  }, [search.new]);

  useEffect(() => {
    setStatus(search.status ?? "all");
  }, [search.status]);

  const setStatusFilter = (next: CalStatus | "all") => {
    setStatus(next);
    void navigate({
      to: "/equipment",
      search: (prev) => {
        const base = { ...(prev as EquipmentSearch) };
        if (next === "all") delete base.status;
        else base.status = next;
        return base;
      },
      replace: true,
    });
  };

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["equipment", q, status],
    queryFn: () => listEquipment({ q: q || undefined, status }),
  });

  const allItems = data?.items ?? [];
  const departments = useMemo(
    () => [...new Set(allItems.map((e) => e.department).filter(Boolean))].sort(),
    [allItems],
  );
  const categories = useMemo(
    () => [...new Set(allItems.map((e) => e.category).filter(Boolean))].sort(),
    [allItems],
  );

  const items = useMemo(
    () =>
      allItems.filter((e) => {
        if (department !== "all" && e.department !== department) return false;
        if (category !== "all" && e.category !== category) return false;
        return true;
      }),
    [allItems, department, category],
  );

  const clearNewParam = () => {
    void navigate({ to: "/equipment", search: {}, replace: true });
  };

  const onCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open && search.new) clearNewParam();
  };

  const onCreate = async (payload: EquipmentPayload) => {
    setSaving(true);
    try {
      const created = await createEquipment(payload);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      onCreateOpenChange(false);
      toast.success("Equipment created");
      void navigate({ to: "/equipment/$id", params: { id: created.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create equipment");
    } finally {
      setSaving(false);
    }
  };

  const onEdit = async (payload: EquipmentPayload) => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateEquipment(editing.id, payload);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      setEditing(null);
      toast.success("Equipment updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update equipment");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (item: AppEquipment) => {
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
    try {
      await deleteEquipment(item.id);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Equipment deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: "Equipment Inventory" }]} hidePageHeader>
      <div className="tg-rise mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Equipment Register & Technical Records
            </h1>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground transition-transform hover:scale-105">
              {isFetching && !items.length ? "…" : `${items.length} items found`}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Master registry of instruments and gauges. Search, filter, and maintain technical
            records for ISO-ready inventory control.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={() => setView("table")}
              className={cn(
                "tg-focus-ring p-2",
                view === "table" ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
              aria-label="Table view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "tg-focus-ring border-l border-border p-2",
                view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Equipment
          </Button>
        </div>
      </div>

      <EquipmentFormDialog
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        mode="create"
        onSubmit={onCreate}
        saving={saving && !editing}
      />
      <EquipmentFormDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        mode="edit"
        initial={editing}
        onSubmit={onEdit}
        saving={saving && !!editing}
      />

      {isError && (
        <ErrorBanner
          message={error instanceof Error ? error.message : "Failed to load equipment. Is the API running?"}
          onRetry={() => void refetch()}
        />
      )}

      <div className="tg-rise mb-4 flex flex-wrap items-center gap-2" style={{ animationDelay: "80ms" }}>
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="equipment-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ID, Instrument name, manufacturer, or S/N..."
            className="h-10 pl-8 transition-shadow focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]"
            aria-label="Search equipment"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatusFilter(e.target.value as CalStatus | "all")}
          className="tg-select w-auto min-w-[140px]"
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          {(Object.keys(statusLabel) as CalStatus[]).map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="tg-select w-auto min-w-[140px]"
          aria-label="Filter by department"
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="tg-select w-auto min-w-[140px]"
          aria-label="Filter by category"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="tg-rise overflow-hidden rounded-xl border border-border bg-card shadow-xs" style={{ animationDelay: "140ms" }}>
        {isLoading ? (
          <PageState variant="loading" title="Loading equipment…" className="m-4 border-0 bg-transparent" />
        ) : view === "table" ? (
          <div className="overflow-x-auto tg-scrollbar max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Tag ID</th>
                  <th className="px-4 py-2.5 font-medium">Gauge / Equipment Name</th>
                  <th className="px-4 py-2.5 font-medium">Serial No</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Department</th>
                  <th className="px-4 py-2.5 font-medium">Last Calibration</th>
                  <th className="px-4 py-2.5 font-medium">Next Due</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-4">
                      <PageState
                        variant="empty"
                        title={
                          q || status !== "all" || department !== "all" || category !== "all"
                            ? "No equipment match your filters"
                            : "No equipment yet"
                        }
                        description={
                          q || status !== "all" || department !== "all" || category !== "all"
                            ? "Try clearing filters or searching a different term."
                            : "Add equipment here, or optionally import from Odoo in Settings."
                        }
                        action={
                          !(q || status !== "all" || department !== "all" || category !== "all")
                            ? { label: "Add equipment", onClick: () => setCreateOpen(true) }
                            : undefined
                        }
                        className="border-0 bg-transparent py-8"
                      />
                    </td>
                  </tr>
                ) : (
                  items.map((e, i) => {
                    const next = parseDate(e.nextCalibration);
                    const last = parseDate(e.lastCalibration);
                    return (
                      <tr
                        key={e.id}
                        className="tg-row-in border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                        style={{ "--stagger": Math.min(i, 12) } as CSSProperties}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{e.tag}</td>
                        <td className="px-4 py-3">
                          <Link
                            to="/equipment/$id"
                            params={{ id: e.id }}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {e.name}
                          </Link>
                          <div className="text-[11px] text-muted-foreground">
                            {[e.manufacturer, e.model].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {e.serial || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{e.category || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.department || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {last ? format(last, "yyyy-MM-dd") : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {next ? format(next, "yyyy-MM-dd") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="tg-focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`Edit ${e.name}`}
                              title="Edit"
                              onClick={() => setEditing(e)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="tg-focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Delete ${e.name}`}
                              title="Delete"
                              onClick={() => void onDelete(e)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : items.length === 0 ? (
          <PageState
            variant="empty"
            title="No equipment yet"
            description="Add equipment or import from Odoo in Settings."
            action={{ label: "Add equipment", onClick: () => setCreateOpen(true) }}
            className="m-4 border-0 bg-transparent"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((e, i) => {
              const next = parseDate(e.nextCalibration);
              const days = next ? differenceInCalendarDays(next, new Date()) : null;
              return (
                <Link
                  key={e.id}
                  to="/equipment/$id"
                  params={{ id: e.id }}
                  className="tg-stagger tg-panel tg-panel-hover tg-focus-ring group rounded-lg border border-border bg-surface p-4"
                  style={{ "--stagger": Math.min(i, 9) } as CSSProperties}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono text-[11px] text-muted-foreground">{e.tag}</div>
                    <StatusBadge status={e.status} />
                  </div>
                  <div className="mt-2 font-medium text-foreground group-hover:text-primary">{e.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[e.manufacturer, e.model].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
                    <span className="text-muted-foreground">{e.department || "—"}</span>
                    <span className="font-medium text-foreground">
                      {days === null
                        ? "—"
                        : days < 0
                          ? `${Math.abs(days)}d overdue`
                          : `Due ${format(next!, "MMM d")}`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Optional:{" "}
        <Link to="/settings" className="text-primary hover:underline">
          import from Odoo
        </Link>
      </p>
    </AppShell>
  );
}
