import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { EquipmentMobileCard } from "@/components/tg/equipment-mobile-card";
import { StatusBadge } from "@/components/tg/status-badge";
import { EquipmentFormDialog } from "@/components/tg/equipment-form-dialog";
import { EquipmentBulkEditDialog } from "@/components/tg/equipment-bulk-edit-dialog";
import { EquipmentTaxonomyDialog } from "@/components/tg/equipment-taxonomy-dialog";
import { PrintLabelsDialog } from "@/components/tg/print-labels-dialog";
import { EquipmentImportExportDialog } from "@/components/tg/equipment-import-export-dialog";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { statusLabel, type CalStatus } from "@/lib/mock-data";
import {
  bulkDeleteEquipment,
  bulkUpdateEquipment,
  createEquipment,
  deleteEquipment,
  getMe,
  getOdooStatus,
  listEquipment,
  updateEquipment,
  type AppEquipment,
  type EquipmentBulkPatch,
  type EquipmentPayload,
} from "@/lib/api";
import { parseDate } from "@/lib/compliance";
import { canDelete, canWrite, isAdminRole } from "@/lib/rbac";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Columns3,
  ChevronDown,
  FileSpreadsheet,
  ListChecks,
  PencilLine,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { differenceInCalendarDays } from "date-fns";
import { useWorkspaceFormat } from "@/lib/format-context";
import { toast } from "sonner";
import {
  EQUIPMENT_COLUMN_DEFS,
  loadEquipmentColumns,
  saveEquipmentColumns,
  visibleColumnCount,
  type EquipmentColumnKey,
  type EquipmentColumnVisibility,
} from "@/lib/equipment-columns";

const MAX_BULK_IDS = 500;

type EquipmentSearch = {
  new?: true;
  status?: CalStatus;
};

const STATUS_VALUES = new Set<string>(Object.keys(statusLabel));

export const Route = createFileRoute("/workspace/$slug/equipment/")({
  head: () => ({ meta: [{ title: "Equipment · TheTruegage" }] }),
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
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columns, setColumns] = useState<EquipmentColumnVisibility>(() =>
    loadEquipmentColumns(slug),
  );

  useEffect(() => {
    setColumns(loadEquipmentColumns(slug));
  }, [slug]);

  const toggleColumn = (key: EquipmentColumnKey, next: boolean) => {
    setColumns((prev) => {
      const updated = { ...prev, [key]: next };
      saveEquipmentColumns(slug, updated);
      return updated;
    });
  };

  const colVisible = (key: EquipmentColumnKey) => columns[key];

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
  const tableColCount =
    visibleColumnCount(columns) + 1 + (allowWrite && selectMode ? 1 : 0);

  const { data: odooStatus } = useQuery({
    queryKey: ["odoo-status"],
    queryFn: getOdooStatus,
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const showOdooImport = isAdmin && Boolean(odooStatus?.configured);

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

  const selectedCount = selectedIds.size;
  const bulkOverCap = selectedCount > MAX_BULK_IDS;

  const onBulkUpdate = async (patch: EquipmentBulkPatch) => {
    if (selectedCount === 0) return;
    if (bulkOverCap) {
      toast.error(`Select at most ${MAX_BULK_IDS} items at a time`);
      return;
    }
    setBulkBusy(true);
    try {
      const result = await bulkUpdateEquipment([...selectedIds], patch);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
      setBulkEditOpen(false);
      if (result.failed > 0) {
        toast.warning(`Updated ${result.updated}, ${result.failed} failed`);
      } else {
        toast.success(`Updated ${result.updated} item${result.updated === 1 ? "" : "s"}`);
      }
      exitSelectMode();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const onBulkDelete = async () => {
    if (selectedCount === 0) return;
    if (bulkOverCap) {
      toast.error(`Select at most ${MAX_BULK_IDS} items at a time`);
      return;
    }
    setBulkBusy(true);
    try {
      const result = await bulkDeleteEquipment([...selectedIds]);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
      setBulkDeleteOpen(false);
      if (result.failed > 0) {
        toast.warning(`Deleted ${result.deleted}, ${result.failed} failed`);
      } else {
        toast.success(`Deleted ${result.deleted} item${result.deleted === 1 ? "" : "s"}`);
      }
      exitSelectMode();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
    } finally {
      setBulkBusy(false);
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
            <span className="tg-count-badge">
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
          {view === "table" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Choose table columns">
                  <Columns3 className="mr-1.5 h-3.5 w-3.5" /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {EQUIPMENT_COLUMN_DEFS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={columns[col.key]}
                    disabled={col.required}
                    onCheckedChange={(checked) => toggleColumn(col.key, checked === true)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {allowWrite && !selectMode && (
            <Button
              size="sm"
              variant="outline"
              data-tour="equipment-select"
              title="Select items to update, delete, or print labels"
              aria-label="Bulk actions: select items to update, delete, or print"
              onClick={enterSelectMode}
            >
              <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Bulk actions
            </Button>
          )}
          {allowWrite && selectMode && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedCount === 0 || bulkBusy || bulkOverCap}
                onClick={() => setBulkEditOpen(true)}
              >
                <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                Update{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
              {allowDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={selectedCount === 0 || bulkBusy || bulkOverCap}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
                </Button>
              )}
              <Button
                size="sm"
                variant="default"
                data-tour="equipment-print-labels"
                disabled={selectedCount === 0 || bulkBusy || bulkOverCap}
                onClick={() => setPrintOpen(true)}
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Print{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={exitSelectMode} disabled={bulkBusy}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            </>
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
          {showOdooImport && !selectMode && (
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
          {allowWrite && !selectMode && (
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              data-tour="equipment-select"
              title="Select items to update, delete, or print labels"
              aria-label="Bulk actions: select items to update, delete, or print"
              onClick={enterSelectMode}
            >
              <ListChecks className="mr-1.5 h-4 w-4" /> Bulk
            </Button>
          )}
          {allowWrite && selectMode && (
            <Button size="sm" variant="ghost" className="h-10 px-2" onClick={exitSelectMode} disabled={bulkBusy}>
              <X className="h-4 w-4" />
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
          {(allowWrite || showOdooImport) && !selectMode && (
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
                {showOdooImport && (
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
          <EquipmentBulkEditDialog
            open={bulkEditOpen}
            onOpenChange={setBulkEditOpen}
            count={selectedCount}
            onSubmit={onBulkUpdate}
            saving={bulkBusy}
          />
          <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {selectedCount} equipment {selectedCount === 1 ? "item" : "items"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the selected equipment and their calibrations and
                  certificates. Prefer bulk update → Inactive to retire assets without deleting
                  history. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={bulkBusy || selectedCount === 0}
                  onClick={(e) => {
                    e.preventDefault();
                    void onBulkDelete();
                  }}
                >
                  {bulkBusy ? "Deleting…" : "Delete permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9.5rem,20%)] sm:gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex h-11 items-center gap-1 rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring md:h-10">
              <Search className="ml-2.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                id="equipment-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  isMobile
                    ? "Search equipment…"
                    : "Search by ID, name, manufacturer, owner, or S/N…"
                }
                className="h-full min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                aria-label="Search equipment"
              />
              <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="relative mr-1 h-8 shrink-0 gap-1 border-l border-border/70 pl-2.5 pr-2 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Filters"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Filters</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                    {sheetFilterCount > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
                        {sheetFilterCount}
                      </span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 space-y-3.5 p-3.5">
                  <p className="text-xs font-medium text-muted-foreground">Filter by</p>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground">Department</span>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className={cn(
                        "tg-select h-9 w-full",
                        department === "all" && "text-muted-foreground",
                      )}
                      aria-label="Filter by department"
                    >
                      <option value="all">Any department</option>
                      {departments.length > 0 && (
                        <option disabled value="">
                          ────────
                        </option>
                      )}
                      {departments.map((d) => (
                        <option key={d} value={d} className="text-foreground">
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground">Category</span>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className={cn(
                        "tg-select h-9 w-full",
                        category === "all" && "text-muted-foreground",
                      )}
                      aria-label="Filter by category"
                    >
                      <option value="all">Any category</option>
                      {categories.length > 0 && (
                        <option disabled value="">
                          ────────
                        </option>
                      )}
                      {categories.map((c) => (
                        <option key={c} value={c} className="text-foreground">
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground">Location</span>
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className={cn(
                        "tg-select h-9 w-full",
                        location === "all" && "text-muted-foreground",
                      )}
                      aria-label="Filter by location"
                    >
                      <option value="all">Any location</option>
                      {locations.length > 0 && (
                        <option disabled value="">
                          ────────
                        </option>
                      )}
                      {locations.map((loc) => (
                        <option key={loc} value={loc} className="text-foreground">
                          {loc}
                        </option>
                      ))}
                    </select>
                  </label>
                  {sheetFilterCount > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-full"
                      onClick={clearSheetFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            {sheetFilterCount > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {department !== "all" && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
                    onClick={() => setDepartment("all")}
                  >
                    Department: {department}
                    <X className="h-3 w-3 opacity-60" />
                  </button>
                )}
                {category !== "all" && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
                    onClick={() => setCategory("all")}
                  >
                    Category: {category}
                    <X className="h-3 w-3 opacity-60" />
                  </button>
                )}
                {location !== "all" && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
                    onClick={() => setLocation("all")}
                  >
                    Location: {location}
                    <X className="h-3 w-3 opacity-60" />
                  </button>
                )}
              </div>
            )}
          </div>
          <select
            value={status}
            onChange={(e) => setStatusFilter(e.target.value as CalStatus | "all")}
            className="tg-select h-11 w-full shrink-0 md:h-10"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            {(Object.keys(statusLabel) as CalStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
        </div>

        {allowWrite && selectMode && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium text-foreground sm:text-sm">
              {selectedCount > 0
                ? `${selectedCount} selected`
                : "Select items to update, delete, or print"}
              {bulkOverCap ? ` · max ${MAX_BULK_IDS}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs md:hidden"
                disabled={selectedCount === 0 || bulkBusy || bulkOverCap}
                onClick={() => setBulkEditOpen(true)}
              >
                <PencilLine className="mr-1 h-3.5 w-3.5" /> Update
              </Button>
              {allowDelete && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive md:hidden"
                  disabled={selectedCount === 0 || bulkBusy || bulkOverCap}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs md:hidden"
                data-tour="equipment-print-labels"
                disabled={selectedCount === 0 || bulkBusy || bulkOverCap}
                onClick={() => setPrintOpen(true)}
              >
                <Printer className="mr-1 h-3.5 w-3.5" /> Print
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={() => toggleSelectAllFiltered()}
                disabled={items.length === 0}
              >
                <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
                {allFilteredSelected ? "Clear all" : "Select all"}
              </Button>
            </div>
          </div>
        )}
      </div>

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
                    {colVisible("tag") && <th className="px-4 py-2.5 font-medium">Tag ID</th>}
                    {colVisible("name") && (
                      <th className="px-4 py-2.5 font-medium">Gauge / Equipment Name</th>
                    )}
                    {colVisible("serial") && (
                      <th className="px-4 py-2.5 font-medium">Serial No</th>
                    )}
                    {colVisible("manufacturer") && (
                      <th className="px-4 py-2.5 font-medium">Manufacturer</th>
                    )}
                    {colVisible("model") && <th className="px-4 py-2.5 font-medium">Model</th>}
                    {colVisible("category") && (
                      <th className="px-4 py-2.5 font-medium">Category</th>
                    )}
                    {colVisible("department") && (
                      <th className="px-4 py-2.5 font-medium">Department</th>
                    )}
                    {colVisible("location") && (
                      <th className="px-4 py-2.5 font-medium">Location</th>
                    )}
                    {colVisible("owner") && <th className="px-4 py-2.5 font-medium">Owner</th>}
                    {colVisible("responsibleEmail") && (
                      <th className="px-4 py-2.5 font-medium">Responsible email</th>
                    )}
                    {colVisible("lastCalibration") && (
                      <th className="px-4 py-2.5 font-medium">Last Calibration</th>
                    )}
                    {colVisible("nextCalibration") && (
                      <th className="px-4 py-2.5 font-medium">Next Due</th>
                    )}
                    {colVisible("status") && <th className="px-4 py-2.5 font-medium">Status</th>}
                    <th className="px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={tableColCount} className="p-4">
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
                      const showMfrSubline =
                        !colVisible("manufacturer") && !colVisible("model");
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
                          {colVisible("tag") && (
                            <td className="px-4 py-3 font-mono text-xs text-foreground">
                              {e.tag}
                            </td>
                          )}
                          {colVisible("name") && (
                            <td className="px-4 py-3">
                              <Link
                                to="/workspace/$slug/equipment/$id"
                                params={{ slug, id: e.id }}
                                className="font-medium text-foreground hover:text-primary"
                              >
                                {e.name}
                              </Link>
                              {showMfrSubline && (
                                <div className="text-[11px] text-muted-foreground">
                                  {[e.manufacturer, e.model].filter(Boolean).join(" · ") || "—"}
                                </div>
                              )}
                            </td>
                          )}
                          {colVisible("serial") && (
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                              {e.serial || "—"}
                            </td>
                          )}
                          {colVisible("manufacturer") && (
                            <td className="px-4 py-3 text-muted-foreground">
                              {e.manufacturer || "—"}
                            </td>
                          )}
                          {colVisible("model") && (
                            <td className="px-4 py-3 text-muted-foreground">{e.model || "—"}</td>
                          )}
                          {colVisible("category") && (
                            <td className="px-4 py-3 text-muted-foreground">
                              {e.category || "—"}
                            </td>
                          )}
                          {colVisible("department") && (
                            <td className="px-4 py-3 text-muted-foreground">
                              {e.department || "—"}
                            </td>
                          )}
                          {colVisible("location") && (
                            <td className="px-4 py-3 text-muted-foreground">
                              {e.location || "—"}
                            </td>
                          )}
                          {colVisible("owner") && (
                            <td className="px-4 py-3 text-muted-foreground">{e.owner || "—"}</td>
                          )}
                          {colVisible("responsibleEmail") && (
                            <td className="px-4 py-3 text-muted-foreground">
                              {e.responsibleEmail || "—"}
                            </td>
                          )}
                          {colVisible("lastCalibration") && (
                            <td className="px-4 py-3 font-mono text-xs">
                              {last ? formatDate(last) : "—"}
                            </td>
                          )}
                          {colVisible("nextCalibration") && (
                            <td className="px-4 py-3 font-mono text-xs">
                              {next ? formatDate(next) : "—"}
                            </td>
                          )}
                          {colVisible("status") && (
                            <td className="px-4 py-3">
                              <StatusBadge status={e.status} />
                            </td>
                          )}
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
                  const selecting = allowWrite && selectMode;
                  const selected = selectedIds.has(e.id);
                  const cardClass = cn(
                    "tg-stagger tg-panel tg-panel-hover tg-focus-ring group rounded-lg border border-border bg-surface p-4 text-left",
                    selecting && selected && "border-primary ring-1 ring-primary/30",
                  );
                  const body = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {selecting && (
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => toggleSelect(e.id)}
                              aria-label={`Select ${e.tag || e.name}`}
                              onClick={(ev) => ev.stopPropagation()}
                            />
                          )}
                          <div className="font-mono text-[11px] text-muted-foreground">{e.tag}</div>
                        </div>
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
                    </>
                  );
                  if (selecting) {
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={cardClass}
                        style={{ "--stagger": Math.min(i, 9) } as CSSProperties}
                        onClick={() => toggleSelect(e.id)}
                      >
                        {body}
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={e.id}
                      to="/workspace/$slug/equipment/$id"
                      params={{ slug, id: e.id }}
                      className={cardClass}
                      style={{ "--stagger": Math.min(i, 9) } as CSSProperties}
                    >
                      {body}
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
