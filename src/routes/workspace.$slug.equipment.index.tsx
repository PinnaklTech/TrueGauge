import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { EquipmentMobileCard } from "@/components/tg/equipment-mobile-card";
import { StatusBadge } from "@/components/tg/status-badge";
import { EquipmentFormDialog } from "@/components/tg/equipment-form-dialog";
import { EquipmentTaxonomyDialog } from "@/components/tg/equipment-taxonomy-dialog";
import { PrintLabelsDialog } from "@/components/tg/print-labels-dialog";
import { EquipmentImportExportDialog } from "@/components/tg/equipment-import-export-dialog";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { statusLabel, type CalStatus } from "@/lib/mock-data";
import {
  createEquipment,
  deleteEquipment,
  getMe,
  listEquipment,
  updateEquipment,
  type AppEquipment,
  type EquipmentPayload,
} from "@/lib/api";
import { parseDate } from "@/lib/compliance";
import { canDelete, canWrite, isAdminRole } from "@/lib/rbac";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  LayoutGrid,
  List,
  Plus,
  Search,
  Pencil,
  Trash2,
  Layers,
  Printer,
  MoreHorizontal,
  SlidersHorizontal,
  X,
  CheckSquare,
  FileSpreadsheet,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { differenceInCalendarDays } from "date-fns";
import { useWorkspaceFormat } from "@/lib/format-context";
import { toast } from "sonner";

type EquipmentSearch = {
  new?: true;
  status?: CalStatus;
};

const STATUS_VALUES = new Set<string>(Object.keys(statusLabel));

export const Route = createFileRoute("/workspace/$slug/equipment/")({
  head: () => ({ meta: [{ title: "Equipment · TrueGage" }] }),
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
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { formatDate } = useWorkspaceFormat();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CalStatus | "all">(search.status ?? "all");
  const [department, setDepartment] = useState("all");
  const [category, setCategory] = useState("all");
  const [location, setLocation] = useState("all");
  const [view, setView] = useState<"table" | "grid" | "cards">("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AppEquipment | null>(null);
  const [saving, setSaving] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const allowWrite = canWrite(me?.role);
  const allowDelete = canDelete(me?.role);
  const isAdmin = isAdminRole(me?.role);

  // Mobile defaults to cards; desktop keeps table/grid
  useEffect(() => {
    if (isMobile) setView("cards");
    else setView((v) => (v === "cards" ? "table" : v));
  }, [isMobile]);

  useEffect(() => {
    if (search.new && allowWrite) setCreateOpen(true);
  }, [search.new, allowWrite]);

  useEffect(() => {
    const onOpenLists = () => setTaxonomyOpen(true);
    const onCloseLists = () => setTaxonomyOpen(false);
    const onOpenCreate = () => {
      setEditing(null);
      setCreateOpen(true);
    };
    const onCloseCreate = () => setCreateOpen(false);
    window.addEventListener("tg-tour-open-lists", onOpenLists);
    window.addEventListener("tg-tour-close-lists", onCloseLists);
    window.addEventListener("tg-tour-open-equipment-create", onOpenCreate);
    window.addEventListener("tg-tour-close-equipment-create", onCloseCreate);
    return () => {
      window.removeEventListener("tg-tour-open-lists", onOpenLists);
      window.removeEventListener("tg-tour-close-lists", onCloseLists);
      window.removeEventListener("tg-tour-open-equipment-create", onOpenCreate);
      window.removeEventListener("tg-tour-close-equipment-create", onCloseCreate);
    };
  }, []);

  useEffect(() => {
    setStatus(search.status ?? "all");
  }, [search.status]);

  const setStatusFilter = (next: CalStatus | "all") => {
    setStatus(next);
    void navigate({
      to: "/workspace/$slug/equipment",
      params: { slug },
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
  const locations = useMemo(
    () => [...new Set(allItems.map((e) => e.location).filter(Boolean))].sort(),
    [allItems],
  );

  const sheetFilterCount =
    (department !== "all" ? 1 : 0) +
    (category !== "all" ? 1 : 0) +
    (location !== "all" ? 1 : 0);

  const hasActiveFilters =
    Boolean(q) ||
    status !== "all" ||
    department !== "all" ||
    category !== "all" ||
    location !== "all";

  const items = useMemo(
    () =>
      allItems.filter((e) => {
        if (department !== "all" && e.department !== department) return false;
        if (category !== "all" && e.category !== category) return false;
        if (location !== "all" && e.location !== location) return false;
        return true;
      }),
    [allItems, department, category, location],
  );

  const allFilteredSelected =
    items.length > 0 && items.every((e) => selectedIds.has(e.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(items.map((e) => e.id)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearNewParam = () => {
    void navigate({ to: "/workspace/$slug/equipment", params: { slug }, search: {}, replace: true });
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
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
      onCreateOpenChange(false);
      toast.success("Equipment created");
      void navigate({ to: "/workspace/$slug/equipment/$id", params: { slug, id: created.id } });
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
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
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
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Equipment deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const clearSheetFilters = () => {
    setDepartment("all");
    setCategory("all");
    setLocation("all");
  };

  return (
    <AppShell breadcrumbs={[{ label: "Equipment Inventory" }]} hidePageHeader>
      <div className="tg-rise mb-4 flex flex-wrap items-start justify-between gap-3 md:mb-6 md:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {isMobile ? "Equipment" : "Equipment Register & Technical Records"}
            </h1>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {isFetching && !items.length ? "…" : `${items.length}`}
            </span>
          </div>
          {!isMobile && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Master registry of instruments and gauges. Search, filter, and maintain technical
              records for ISO-ready inventory control.
            </p>
          )}
        </div>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 md:flex">
          <div className="flex items-center rounded-lg border border-border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setView("table")}
              className={cn(
                "tg-focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                view === "table"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Table view"
              aria-pressed={view === "table"}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "tg-focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                view === "grid"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Grid view"
              aria-pressed={view === "grid"}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          {allowWrite && (
            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              data-tour="equipment-print-labels"
              onClick={() => (selectMode ? setPrintOpen(true) : enterSelectMode())}
              disabled={selectMode && selectedIds.size === 0}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              {selectMode
                ? selectedIds.size > 0
                  ? `Print labels (${selectedIds.size})`
                  : "Pick items to print"
                : "Print labels"}
            </Button>
          )}
          {allowWrite && selectMode && (
            <Button size="sm" variant="ghost" onClick={exitSelectMode}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {allowWrite && !selectMode && (
            <Button
              size="sm"
              variant="outline"
              data-tour="equipment-import-export"
              onClick={() => setImportExportOpen(true)}
            >
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Import / Export
            </Button>
          )}
          {allowWrite && !selectMode && (
            <Button
              size="sm"
              variant="outline"
              data-tour="equipment-lists"
              onClick={() => setTaxonomyOpen(true)}
            >
              <Layers className="mr-1.5 h-3.5 w-3.5" /> Lists
            </Button>
          )}
          {isAdmin && !selectMode && (
            <Button size="sm" variant="outline" asChild>
              <Link
                to="/workspace/$slug/settings"
                params={{ slug }}
                search={{ section: "integrations" }}
              >
                Import from Odoo
              </Link>
            </Button>
          )}
          {allowWrite && !selectMode && (
            <Button size="sm" data-tour="equipment-add" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Equipment
            </Button>
          )}
        </div>

        {/* Mobile actions: Add primary + overflow */}
        <div className="flex items-center gap-2 md:hidden">
          {allowWrite && (
            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              className="h-10"
              data-tour="equipment-print-labels"
              onClick={() => (selectMode ? setPrintOpen(true) : enterSelectMode())}
              disabled={selectMode && selectedIds.size === 0}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              {selectMode ? (selectedIds.size || "Print") : "Print"}
            </Button>
          )}
          {allowWrite && !selectMode && (
            <Button
              size="sm"
              className="h-10"
              data-tour="equipment-add"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          )}
          {(allowWrite || isAdmin) && !selectMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 w-10 px-0"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {allowWrite && (
                  <DropdownMenuItem
                    data-tour="equipment-import-export"
                    onClick={() => setImportExportOpen(true)}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" /> Import / Export
                  </DropdownMenuItem>
                )}
                {allowWrite && (
                  <DropdownMenuItem
                    data-tour="equipment-lists"
                    onClick={() => setTaxonomyOpen(true)}
                  >
                    <Layers className="mr-2 h-4 w-4" /> Lists
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/workspace/$slug/settings"
                      params={{ slug }}
                      search={{ section: "integrations" }}
                    >
                      Import from Odoo
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {allowWrite && selectMode && (
            <Button size="sm" variant="ghost" className="h-10 px-2" onClick={exitSelectMode}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {allowWrite && (
        <>
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
          <EquipmentTaxonomyDialog
            open={taxonomyOpen}
            onOpenChange={setTaxonomyOpen}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["equipment"] });
            }}
          />
          <PrintLabelsDialog
            open={printOpen}
            onOpenChange={setPrintOpen}
            equipmentIds={[...selectedIds]}
          />
          <EquipmentImportExportDialog
            open={importExportOpen}
            onOpenChange={setImportExportOpen}
            onImported={() => {
              void queryClient.invalidateQueries({ queryKey: ["equipment"] });
              void queryClient.invalidateQueries({ queryKey: ["audit"] });
            }}
          />
        </>
      )}

      {isError && (
        <ErrorBanner
          message={
            error instanceof Error
              ? error.message
              : "Failed to load equipment. Is the API running?"
          }
          onRetry={() => void refetch()}
        />
      )}

      {/* Sticky filter strip */}
      <div
        className="tg-rise sticky top-0 z-20 -mx-1 mb-4 space-y-2 bg-background/95 px-1 py-2 backdrop-blur-md md:static md:mx-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
        style={{ animationDelay: "80ms" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="equipment-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={isMobile ? "Search equipment…" : "Search by ID, name, manufacturer, or S/N…"}
              className="h-11 pl-8 md:h-10"
              aria-label="Search equipment"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatusFilter(e.target.value as CalStatus | "all")}
            className="tg-select h-11 min-w-[120px] md:h-10 md:min-w-[140px]"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            {(Object.keys(statusLabel) as CalStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>

          {/* Desktop inline filters */}
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="tg-select hidden h-10 w-auto min-w-[140px] md:block"
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
            className="tg-select hidden h-10 w-auto min-w-[140px] md:block"
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="tg-select hidden h-10 w-auto min-w-[140px] md:block"
            aria-label="Filter by location"
          >
            <option value="all">All Locations</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          {/* Mobile Filters sheet trigger */}
          <Button
            type="button"
            variant="outline"
            className="relative h-11 min-w-11 px-3 md:hidden"
            onClick={() => setFiltersOpen(true)}
            aria-label="More filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {sheetFilterCount > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {sheetFilterCount}
              </span>
            ) : null}
          </Button>
        </div>

        {allowWrite && selectMode && items.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
            <p className="text-xs font-medium text-foreground sm:text-sm">
              Tap items to select for printing
              {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={() => toggleSelectAllFiltered()}
            >
              <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
              {allFilteredSelected ? "Clear all" : "Select all"}
            </Button>
          </div>
        )}
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Department</span>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="tg-select h-11 w-full"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="tg-select h-11 w-full"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Location</span>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="tg-select h-11 w-full"
              >
                <option value="all">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <SheetFooter className="mt-6 flex-row gap-2 sm:space-x-0">
            <Button variant="outline" className="h-11 flex-1" onClick={clearSheetFilters}>
              Clear
            </Button>
            <Button className="h-11 flex-1" onClick={() => setFiltersOpen(false)}>
              Apply
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Mobile card list */}
      {view === "cards" ? (
        <div className="tg-rise space-y-2" style={{ animationDelay: "140ms" }}>
          {isLoading ? (
            <PageState variant="loading" title="Loading equipment…" className="border-0 bg-transparent" />
          ) : items.length === 0 ? (
            <PageState
              variant="empty"
              title={hasActiveFilters ? "No equipment match your filters" : "No equipment yet"}
              description={
                hasActiveFilters
                  ? "Try clearing filters or searching a different term."
                  : "Add equipment here, or optionally import from Odoo in Settings."
              }
              action={
                allowWrite && !hasActiveFilters
                  ? { label: "Add equipment", onClick: () => setCreateOpen(true) }
                  : undefined
              }
              className="border-0 bg-transparent py-8"
            />
          ) : (
            items.map((e) => (
              <EquipmentMobileCard
                key={e.id}
                item={e}
                slug={slug}
                allowSelect={allowWrite && selectMode}
                selected={selectedIds.has(e.id)}
                onToggleSelect={() => toggleSelect(e.id)}
              />
            ))
          )}
        </div>
      ) : (
        <div
          className="tg-rise overflow-hidden rounded-xl border border-border bg-card shadow-xs"
          style={{ animationDelay: "140ms" }}
        >
          {isLoading ? (
            <PageState
              variant="loading"
              title="Loading equipment…"
              className="m-4 border-0 bg-transparent"
            />
          ) : view === "table" ? (
            <div className="overflow-x-auto tg-scrollbar max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {allowWrite && selectMode && (
                      <th className="w-10 px-3 py-2.5">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={() => toggleSelectAllFiltered()}
                          aria-label="Select all matching filters"
                        />
                      </th>
                    )}
                    <th className="px-4 py-2.5 font-medium">Tag ID</th>
                    <th className="px-4 py-2.5 font-medium">Gauge / Equipment Name</th>
                    <th className="px-4 py-2.5 font-medium">Serial No</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Department</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Last Calibration</th>
                    <th className="px-4 py-2.5 font-medium">Next Due</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={allowWrite && selectMode ? 11 : 10} className="p-4">
                        <PageState
                          variant="empty"
                          title={
                            hasActiveFilters
                              ? "No equipment match your filters"
                              : "No equipment yet"
                          }
                          description={
                            hasActiveFilters
                              ? "Try clearing filters or searching a different term."
                              : "Add equipment here, or optionally import from Odoo in Settings."
                          }
                          action={
                            allowWrite && !hasActiveFilters
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
                          {allowWrite && selectMode && (
                            <td className="px-3 py-3">
                              <Checkbox
                                checked={selectedIds.has(e.id)}
                                onCheckedChange={() => toggleSelect(e.id)}
                                aria-label={`Select ${e.tag || e.name}`}
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 font-mono text-xs text-foreground">{e.tag}</td>
                          <td className="px-4 py-3">
                            <Link
                              to="/workspace/$slug/equipment/$id"
                              params={{ slug, id: e.id }}
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
                          <td className="px-4 py-3 text-muted-foreground">{e.location || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {last ? formatDate(last) : "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {next ? formatDate(next) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={e.status} />
                          </td>
                          <td className="px-4 py-3">
                            {(allowWrite || allowDelete) && (
                              <div className="flex items-center gap-1">
                                {allowWrite && (
                                  <button
                                    type="button"
                                    className="tg-focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                    aria-label={`Edit ${e.name}`}
                                    title="Edit"
                                    onClick={() => setEditing(e)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {allowDelete && (
                                  <button
                                    type="button"
                                    className="tg-focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    aria-label={`Delete ${e.name}`}
                                    title="Delete"
                                    onClick={() => void onDelete(e)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
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
              action={
                allowWrite
                  ? { label: "Add equipment", onClick: () => setCreateOpen(true) }
                  : undefined
              }
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <div className="max-h-[70vh] overflow-y-auto tg-scrollbar">
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((e, i) => {
                  const next = parseDate(e.nextCalibration);
                  const days = next ? differenceInCalendarDays(next, new Date()) : null;
                  return (
                    <Link
                      key={e.id}
                      to="/workspace/$slug/equipment/$id"
                      params={{ slug, id: e.id }}
                      className="tg-stagger tg-panel tg-panel-hover tg-focus-ring group rounded-lg border border-border bg-surface p-4"
                      style={{ "--stagger": Math.min(i, 9) } as CSSProperties}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-mono text-[11px] text-muted-foreground">{e.tag}</div>
                        <StatusBadge status={e.status} />
                      </div>
                      <div className="mt-2 font-medium text-foreground group-hover:text-primary">
                        {e.name}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[e.manufacturer, e.model].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
                        <span className="truncate text-muted-foreground">
                          {[e.department, e.location].filter(Boolean).join(" · ") || "—"}
                        </span>
                        <span className="font-medium text-foreground">
                          {days === null
                            ? "—"
                            : days < 0
                              ? `${Math.abs(days)}d overdue`
                              : `Due ${formatDate(next!)}`}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
