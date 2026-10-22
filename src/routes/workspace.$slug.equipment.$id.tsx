import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { EquipmentDetailHero } from "@/components/tg/equipment-detail-hero";
import { EquipmentFormDialog } from "@/components/tg/equipment-form-dialog";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import {
  ApiError,
  deleteCertificate,
  deleteEquipment,
  getEquipment,
  getMe,
  listEquipmentCalibrations,
  listEquipmentCertificates,
  regenerateQrToken,
  updateEquipment,
  type AppCalibration,
  type AppCertificate,
  type AppEquipment,
  type EquipmentPayload,
} from "@/lib/api";
import { canDelete, canWrite, isAdminRole } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { useWorkspaceFormat } from "@/lib/format-context";
import {
  ArrowLeft,
  Edit3,
  Eye,
  FileText,
  MoreHorizontal,
  Printer,
  QrCode,
  ScanLine,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CertificatePreviewDialog } from "@/components/tg/certificate-preview-dialog";
import { CertificateUploadControl } from "@/components/tg/certificate-upload-control";
import { PrintLabelsDialog } from "@/components/tg/print-labels-dialog";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";

function parseDate(value: string) {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

type DetailTab = "overview" | "history" | "documents" | "label";

export const Route = createFileRoute("/workspace/$slug/equipment/$id")({
  head: () => ({ meta: [{ title: "Equipment · TheTruegage" }] }),
  validateSearch: (search: Record<string, unknown>): { from?: "scan" } => {
    if (search.from === "scan") return { from: "scan" };
    return {};
  },
  component: EquipmentDetail,
});

function EquipmentDetail() {
  const { formatDate } = useWorkspaceFormat();
  const { slug, id } = Route.useParams();
  const { from: fromScan } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<AppCertificate | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [tab, setTab] = useState<DetailTab>("overview");
  const arrivedFromScan = fromScan === "scan";

  const {
    data: item,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["equipment", id],
    queryFn: () => getEquipment(id),
  });
  const { data: liveHistory } = useQuery({
    queryKey: ["calibrations", id],
    queryFn: () => listEquipmentCalibrations(id),
    enabled: !!item,
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const allowWrite = canWrite(me?.role);
  const allowDelete = canDelete(me?.role);
  const isAdmin = isAdminRole(me?.role);
  const storageEnabled = Boolean(me?.storage_enabled);
  const { data: certData, refetch: refetchCerts } = useQuery({
    queryKey: ["certificates", "equipment", id],
    queryFn: () => listEquipmentCertificates(id),
    enabled: !!item && storageEnabled,
  });
  const certificates = certData?.items ?? [];
  const history: AppCalibration[] = liveHistory?.items ?? [];

  const notFound = isError && error instanceof ApiError && error.status === 404;

  if (isLoading) {
    return (
      <AppShell breadcrumbs={[{ label: "Equipment", to: `/workspace/${slug}/equipment` }, { label: "…" }]}>
        <PageState variant="loading" title="Loading equipment…" />
      </AppShell>
    );
  }

  if (notFound) {
    return (
      <AppShell title="Not found">
        <p className="text-sm text-muted-foreground">
          Equipment not found.{" "}
          <Link to="/workspace/$slug/equipment" params={{ slug }} className="text-primary">
            Back to list
          </Link>
        </p>
      </AppShell>
    );
  }

  if (isError || !item) {
    return (
      <AppShell breadcrumbs={[{ label: "Equipment", to: `/workspace/${slug}/equipment` }, { label: "Error" }]}>
        <ErrorBanner
          message={error instanceof Error ? error.message : "Could not load equipment"}
          onRetry={() => void refetch()}
        />
      </AppShell>
    );
  }

  const next = parseDate(item.nextCalibration);
  const last = parseDate(item.lastCalibration);
  const days = next ? differenceInCalendarDays(next, new Date()) : null;

  const onSave = async (payload: EquipmentPayload) => {
    setSaving(true);
    try {
      await updateEquipment(item.id, payload);
      setEditOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["equipment", id] });
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Equipment updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    try {
      await deleteEquipment(item.id);
      toast.success("Equipment deleted");
      await navigate({ to: "/workspace/$slug/equipment", params: { slug }, replace: true });
      void queryClient.invalidateQueries({ queryKey: ["equipment"] });
      void queryClient.invalidateQueries({ queryKey: ["calibrations"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const onRegenerate = () => {
    if (
      !window.confirm(
        "Regenerate QR token? Existing printed labels for this item will stop working.",
      )
    ) {
      return;
    }
    setRegenerating(true);
    void regenerateQrToken(item.id)
      .then(async () => {
        toast.success("QR token regenerated");
        await queryClient.invalidateQueries({ queryKey: ["equipment", id] });
        await queryClient.invalidateQueries({ queryKey: ["audit"] });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Regenerate failed"))
      .finally(() => setRegenerating(false));
  };

  const previewCalibrationCertificate = (certificateId: string, fileName: string) => {
    const found = certificates.find((c) => c.id === certificateId);
    if (found) {
      setPreview(found);
      return;
    }
    setPreview({
      id: certificateId,
      equipmentId: item.id,
      equipmentTag: item.tag,
      equipmentName: item.name,
      calibrationId: null,
      fileName,
      contentType: "application/pdf",
      sizeBytes: 0,
      sha256: "",
      status: "ready",
      uploadedBy: null,
      createdAt: null,
    });
  };

  // Shop-floor sticky actions on all mobile detail views (list, overdue, scan, etc.)
  const showStickyBar = allowWrite || arrivedFromScan;

  return (
    <AppShell
      breadcrumbs={[{ label: "Equipment", to: `/workspace/${slug}/equipment` }, { label: item.tag || item.name }]}
    >
      <div className={cn(showStickyBar && "pb-28 md:pb-0")}>
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <Link
            to="/workspace/$slug/equipment"
            params={{ slug }}
            className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted md:h-8 md:w-8"
            aria-label="Back to equipment"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            {/* Desktop title row — mobile uses hero */}
            <div className="hidden md:block">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                    {item.name}
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span className="font-mono text-xs">{item.tag}</span>
                    {" · "}
                    {[item.manufacturer, item.model, item.serial].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <DesktopActions
                  slug={slug}
                  item={item}
                  arrivedFromScan={arrivedFromScan}
                  allowWrite={allowWrite}
                  allowDelete={allowDelete}
                  onEdit={() => setEditOpen(true)}
                  onPrint={() => setPrintOpen(true)}
                  onDelete={() => void onDelete()}
                />
              </div>
            </div>
            <p className="font-display text-base font-semibold text-foreground md:hidden">
              Equipment
            </p>
          </div>
          {/* Mobile overflow */}
          <div className="md:hidden">
            <MoreMenu
              allowWrite={allowWrite}
              allowDelete={allowDelete}
              onEdit={() => setEditOpen(true)}
              onPrint={() => setPrintOpen(true)}
              onDelete={() => void onDelete()}
            />
          </div>
        </div>

        {/* Hero — always on mobile; summary strip on desktop via tabs overview */}
        <div className="mb-4 md:hidden">
          <EquipmentDetailHero
            tag={item.tag}
            name={item.name}
            status={item.status}
            source={item.source}
            lastDate={last}
            nextDate={next}
            daysUntilDue={days}
            frequencyDays={item.frequencyDays}
            compact
          />
        </div>

        {allowWrite && (
          <EquipmentFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            mode="edit"
            initial={item}
            onSubmit={onSave}
            saving={saving}
          />
        )}
        {allowWrite && (
          <PrintLabelsDialog
            open={printOpen}
            onOpenChange={setPrintOpen}
            equipmentIds={[item.id]}
          />
        )}

        {/* Mobile: stacked sections */}
        <div className="space-y-4 md:hidden">
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Overview
            </h2>
            <div className="grid gap-3">
              <DetailBlock title="Identity">
                <DetailRow label="Tag" value={<span className="font-mono">{item.tag || "—"}</span>} />
                <DetailRow label="Serial" value={<span className="font-mono">{item.serial || "—"}</span>} />
                <DetailRow label="Category" value={item.category || "—"} />
                <DetailRow label="Manufacturer" value={item.manufacturer || "—"} />
                <DetailRow label="Model" value={item.model || "—"} />
              </DetailBlock>
              <DetailBlock title="Location & ownership">
                <DetailRow label="Department" value={item.department || "—"} />
                <DetailRow label="Location" value={item.location || "—"} />
                <DetailRow label="Owner" value={item.owner || "—"} />
              </DetailBlock>
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              History
            </h2>
            <HistoryPanel
              history={history}
              slug={slug}
              equipmentId={item.id}
              allowWrite={allowWrite}
              onPreviewCertificate={previewCalibrationCertificate}
            />
          </section>
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Documents
            </h2>
            <DocumentsPanel
              storageEnabled={storageEnabled}
              allowWrite={allowWrite}
              certificates={certificates}
              equipmentId={item.id}
              onPreview={setPreview}
              onUploaded={async () => {
                await refetchCerts();
                await queryClient.invalidateQueries({ queryKey: ["certificates"] });
                await queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
              onDeleted={async () => {
                await refetchCerts();
                await queryClient.invalidateQueries({ queryKey: ["certificates"] });
                await queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
            />
          </section>
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Label
            </h2>
            <LabelPanel
              item={item}
              allowWrite={allowWrite}
              isAdmin={isAdmin}
              regenerating={regenerating}
              onPrint={() => setPrintOpen(true)}
              onRegenerate={onRegenerate}
            />
          </section>
        </div>

        {/* Desktop: tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as DetailTab)}
          className="hidden w-full md:block"
        >
          <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 border border-border bg-muted p-1">
            {(
              [
                ["overview", "Overview"],
                ["history", "History"],
                ["documents", "Documents"],
                ["label", "Label"],
              ] as const
            ).map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  "min-h-10 flex-1 px-4 sm:flex-none",
                  "transition-colors duration-200 ease-out",
                  "data-[state=inactive]:text-muted-foreground",
                  "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
                  "data-[state=active]:shadow-none",
                )}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-4">
            <EquipmentDetailHero
              tag={item.tag}
              name={item.name}
              status={item.status}
              source={item.source}
              manufacturer={item.manufacturer}
              model={item.model}
              serial={item.serial}
              lastDate={last}
              nextDate={next}
              daysUntilDue={days}
              frequencyDays={item.frequencyDays}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <DetailBlock title="Identity">
                <DetailRow label="Tag" value={<span className="font-mono">{item.tag || "—"}</span>} />
                <DetailRow label="Serial" value={<span className="font-mono">{item.serial || "—"}</span>} />
                <DetailRow label="Category" value={item.category || "—"} />
                <DetailRow label="Manufacturer" value={item.manufacturer || "—"} />
                <DetailRow label="Model" value={item.model || "—"} />
              </DetailBlock>
              <DetailBlock title="Location & ownership">
                <DetailRow label="Department" value={item.department || "—"} />
                <DetailRow label="Location" value={item.location || "—"} />
                <DetailRow label="Owner" value={item.owner || "—"} />
              </DetailBlock>
            </div>
            {history[0] ? (
              <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
                <h3 className="text-sm font-semibold text-foreground">Latest calibration</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(history[0].date)} · {history[0].result} ·{" "}
                  {history[0].technician || "—"}
                </p>
                <Button
                  variant="link"
                  className="mt-1 h-auto px-0"
                  onClick={() => setTab("history")}
                >
                  View full history
                </Button>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <HistoryPanel
              history={history}
              slug={slug}
              equipmentId={item.id}
              allowWrite={allowWrite}
              onPreviewCertificate={previewCalibrationCertificate}
            />
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <DocumentsPanel
              storageEnabled={storageEnabled}
              allowWrite={allowWrite}
              certificates={certificates}
              equipmentId={item.id}
              onPreview={setPreview}
              onUploaded={async () => {
                await refetchCerts();
                await queryClient.invalidateQueries({ queryKey: ["certificates"] });
                await queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
              onDeleted={async () => {
                await refetchCerts();
                await queryClient.invalidateQueries({ queryKey: ["certificates"] });
                await queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
            />
          </TabsContent>

          <TabsContent value="label" className="mt-0">
            <LabelPanel
              item={item}
              allowWrite={allowWrite}
              isAdmin={isAdmin}
              regenerating={regenerating}
              onPrint={() => setPrintOpen(true)}
              onRegenerate={onRegenerate}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Sticky shop-floor bar — portaled so page animations can't trap `position: fixed` */}
      {showStickyBar && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
              <div className="mx-auto flex max-w-lg gap-2">
                {arrivedFromScan ? (
                  <Button variant="outline" className="h-12 min-w-0 flex-1 text-base" asChild>
                    <Link to="/workspace/$slug/scan" params={{ slug }}>
                      <ScanLine className="mr-1.5 h-4 w-4" />
                      Scan next
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="h-12 min-w-0 flex-1 text-base"
                    onClick={() => {
                      if (typeof window !== "undefined" && window.history.length > 1) {
                        window.history.back();
                        return;
                      }
                      void navigate({ to: "/workspace/$slug/equipment", params: { slug } });
                    }}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" />
                    Back
                  </Button>
                )}
                {allowWrite ? (
                  <Button className="h-12 min-w-0 flex-[1.6] text-base" asChild>
                    <Link
                      to="/workspace/$slug/calibrations"
                      params={{ slug }}
                      search={{ tab: "log", equipment: item.id }}
                    >
                      <Wrench className="mr-1.5 h-4 w-4" />
                      Log calibration
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}

      <CertificatePreviewDialog
        open={!!preview}
        certificateId={preview?.id ?? null}
        fileName={preview?.fileName}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </AppShell>
  );
}

function DesktopActions({
  slug,
  item,
  arrivedFromScan,
  allowWrite,
  allowDelete,
  onEdit,
  onPrint,
  onDelete,
}: {
  slug: string;
  item: AppEquipment;
  arrivedFromScan: boolean;
  allowWrite: boolean;
  allowDelete: boolean;
  onEdit: () => void;
  onPrint: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {arrivedFromScan && (
        <Button variant="outline" size="sm" asChild>
          <Link to="/workspace/$slug/scan" params={{ slug }}>
            <ScanLine className="mr-1.5 h-3.5 w-3.5" />
            Scan next
          </Link>
        </Button>
      )}
      {allowWrite && (
        <Button
          size="sm"
          className={arrivedFromScan ? "shadow-md ring-2 ring-primary/30" : undefined}
          asChild
        >
          <Link
            to="/workspace/$slug/calibrations"
            params={{ slug }}
            search={{ tab: "log", equipment: item.id }}
          >
            <Wrench className="mr-1.5 h-3.5 w-3.5" />
            Log calibration
          </Link>
        </Button>
      )}
      <MoreMenu
        allowWrite={allowWrite}
        allowDelete={allowDelete}
        onEdit={onEdit}
        onPrint={onPrint}
        onDelete={onDelete}
      />
    </div>
  );
}

function MoreMenu({
  allowWrite,
  allowDelete,
  onEdit,
  onPrint,
  onDelete,
}: {
  allowWrite: boolean;
  allowDelete: boolean;
  onEdit: () => void;
  onPrint: () => void;
  onDelete: () => void;
}) {
  if (!allowWrite && !allowDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-10 w-10 px-0 md:h-8 md:w-8" aria-label="More actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {allowWrite && (
          <DropdownMenuItem onClick={onEdit}>
            <Edit3 className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
        )}
        {allowWrite && (
          <DropdownMenuItem onClick={onPrint}>
            <Printer className="mr-2 h-4 w-4" /> Print label
          </DropdownMenuItem>
        )}
        {allowDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HistoryPanel({
  history,
  slug,
  equipmentId,
  allowWrite,
  onPreviewCertificate,
}: {
  history: AppCalibration[];
  slug: string;
  equipmentId: string;
  allowWrite: boolean;
  onPreviewCertificate?: (certificateId: string, fileName: string) => void;
}) {
  const { formatDate } = useWorkspaceFormat();
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">Calibration timeline</h2>
        <p className="text-xs text-muted-foreground">History of verification runs for this gauge</p>
      </div>
      <ol className="relative px-5 py-4">
        <div className="absolute bottom-4 left-[30px] top-4 w-px bg-border" />
        {history.map((c) => {
          const certLabel = c.certificateNo || c.certificateFileName;
          return (
          <li key={c.id} className="relative flex gap-4 py-3">
            <div
              className={cn(
                "relative z-10 mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-4 ring-card",
                c.result === "pass"
                  ? "bg-[color:var(--color-success)]"
                  : c.result === "fail"
                    ? "bg-[color:var(--color-destructive)]"
                    : "bg-[color:var(--color-warning)]",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-foreground">
                  {c.type === "external" ? "External calibration" : "Internal calibration"}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {formatDate(c.date)}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {c.result}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                By {c.technician || "—"} · {c.provider || "—"}
              </p>
              {c.hasCertificate ? (
                c.certificateId && onPreviewCertificate ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex max-w-full items-center gap-1.5 text-xs text-primary hover:underline"
                    onClick={() =>
                      onPreviewCertificate(c.certificateId!, certLabel || c.certificateFileName || "Certificate")
                    }
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{certLabel || "Certificate attached"}</span>
                  </button>
                ) : (
                  <p className="mt-1 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{certLabel || "Certificate attached"}</span>
                  </p>
                )
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">No certificate linked</p>
              )}
              {c.notes && (
                <p className="mt-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground">
                  {c.notes}
                </p>
              )}
            </div>
          </li>
          );
        })}
        {history.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            No calibration history yet.
            {allowWrite && (
              <>
                {" "}
                <Link
                  to="/workspace/$slug/calibrations"
                  params={{ slug }}
                  search={{ tab: "log", equipment: equipmentId }}
                  className="text-primary hover:underline"
                >
                  Log the first record
                </Link>
              </>
            )}
          </li>
        )}
      </ol>
    </div>
  );
}

function DocumentsPanel({
  storageEnabled,
  allowWrite,
  certificates,
  equipmentId,
  onPreview,
  onUploaded,
  onDeleted,
}: {
  storageEnabled: boolean;
  allowWrite: boolean;
  certificates: AppCertificate[];
  equipmentId: string;
  onPreview: (c: AppCertificate) => void;
  onUploaded: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { formatDateTime } = useWorkspaceFormat();
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">Documents</h2>
        {storageEnabled && allowWrite ? (
          <CertificateUploadControl compact equipmentId={equipmentId} onUploaded={onUploaded} />
        ) : null}
      </div>
      {!storageEnabled ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">
          Certificate vault is not included in your plan. Contact TheTruegage to enable document
          storage.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {certificates.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-muted-foreground">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{c.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {c.createdAt ? `Uploaded ${formatDateTime(c.createdAt)}` : "Uploaded"}
                  {c.uploadedBy ? ` · ${c.uploadedBy}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 text-muted-foreground"
                onClick={() => onPreview(c)}
                aria-label={`View ${c.fileName}`}
              >
                <Eye className="h-4 w-4" />
              </Button>
              {allowWrite ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 w-10 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (!window.confirm(`Delete ${c.fileName}?`)) return;
                    void deleteCertificate(c.id)
                      .then(async () => {
                        toast.success("Certificate deleted");
                        await onDeleted();
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Delete failed"));
                  }}
                  aria-label={`Delete ${c.fileName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
          {certificates.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-muted-foreground">
              No PDF certificates uploaded yet.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function LabelPanel({
  item,
  allowWrite,
  isAdmin,
  regenerating,
  onPrint,
  onRegenerate,
}: {
  item: AppEquipment;
  allowWrite: boolean;
  isAdmin: boolean;
  regenerating: boolean;
  onPrint: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="border-b border-border px-5 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <QrCode className="h-4 w-4" />
          QR label
        </h3>
      </div>
      <div className="flex flex-col items-center gap-3 px-5 py-6">
        {item.qrToken ? (
          <EquipmentQrPreview token={item.qrToken} size={isAdmin || allowWrite ? 140 : 120} />
        ) : (
          <p className="text-xs text-muted-foreground">No QR token yet</p>
        )}
        <p className="font-mono text-[11px] text-muted-foreground">
          {item.qrToken ? `/q/${item.qrToken}` : "—"}
        </p>
        <div className="flex w-full max-w-sm flex-wrap gap-2">
          {allowWrite && (
            <Button size="default" variant="outline" className="h-11 min-h-11 flex-1" onClick={onPrint}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print label
            </Button>
          )}
          {isAdmin && (
            <Button
              size="default"
              variant="destructive"
              className="h-11 min-h-11 flex-1"
              disabled={regenerating}
              onClick={onRegenerate}
            >
              Regenerate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EquipmentQrPreview({ token, size = 160 }: { token: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = `${window.location.origin}/q/${token}`;
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: size,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setDataUrl);
  }, [token, size]);
  if (!dataUrl) {
    return <div className="animate-pulse rounded bg-muted" style={{ width: size, height: size }} />;
  }
  return (
    <img
      src={dataUrl}
      alt={`QR for ${token}`}
      className="rounded border border-border bg-white"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
