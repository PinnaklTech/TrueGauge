import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { CertificatePreviewDialog } from "@/components/tg/certificate-preview-dialog";
import { CertificateUploadControl } from "@/components/tg/certificate-upload-control";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import {
  deleteCertificate,
  getCertificateViewUrl,
  getMe,
  listCertificates,
  listEquipment,
  uploadCertificateFile,
  type AppCertificate,
} from "@/lib/api";
import { canWrite } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workspace/$slug/certificates")({
  head: () => ({ meta: [{ title: "Certificates · TrueGage" }] }),
  component: CertificatesPage,
});

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function displayCertId(id: string) {
  const raw = (id || "").replace(/^crt-/i, "").toUpperCase();
  if (raw.length <= 12) return `CERT-${raw}`;
  return `CERT-${raw.slice(0, 8)}`;
}

function CertificatesPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<AppCertificate | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [assignGaugeId, setAssignGaugeId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const equipmentSearchRef = useRef<HTMLInputElement>(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const allowWrite = canWrite(me?.role);
  const storageEnabled = Boolean(me?.storage_enabled);
  const usedBytes = me?.storage_used_bytes ?? 0;
  const quotaBytes = me?.storage_quota_bytes ?? 0;
  const usagePct =
    storageEnabled && quotaBytes > 0
      ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
      : 0;
  const nearQuota = storageEnabled && usagePct >= 90;
  const atQuota = storageEnabled && usagePct >= 100;

  const { data: equipmentData } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
    enabled: storageEnabled,
  });
  const equipment = equipmentData?.items ?? [];

  const {
    data: certData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["certificates", q],
    queryFn: () => listCertificates({ q: q || undefined }),
    enabled: storageEnabled,
  });
  const certificates = certData?.items ?? [];

  const equipmentOptions = useMemo(
    () =>
      equipment.map((e) => ({
        id: e.id,
        tag: e.tag || "",
        name: e.name,
      })),
    [equipment],
  );

  const filteredEquipment = useMemo(() => {
    const q = equipmentQuery.trim().toLowerCase();
    if (!q) return equipmentOptions;
    return equipmentOptions.filter((o) => {
      const tag = o.tag.toLowerCase();
      const name = o.name.toLowerCase();
      return tag.includes(q) || name.includes(q) || `[${tag}]`.includes(q);
    });
  }, [equipmentOptions, equipmentQuery]);

  const selectedEquipment = equipmentOptions.find((o) => o.id === assignGaugeId);

  const closeAssignDialog = () => {
    if (assignBusy) return;
    setPendingFile(null);
    setAssignGaugeId("");
    setEquipmentQuery("");
  };

  const confirmAssignUpload = async () => {
    if (!pendingFile || !assignGaugeId) {
      toast.error("Select which equipment this certificate belongs to");
      return;
    }
    setAssignBusy(true);
    try {
      await uploadCertificateFile({
        file: pendingFile,
        equipmentId: assignGaugeId,
      });
      toast.success("Certificate uploaded");
      setPendingFile(null);
      setAssignGaugeId("");
      setEquipmentQuery("");
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setAssignBusy(false);
    }
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCertificate(id),
    onSuccess: async () => {
      toast.success("Certificate deleted");
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const onDownload = async (cert: AppCertificate) => {
    setDownloadingId(cert.id);
    try {
      const res = await getCertificateViewUrl(cert.id);
      const a = document.createElement("a");
      a.href = res.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.download = cert.fileName || "certificate.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: "Compliance Documents", to: `/workspace/${slug}/certificates` }]} hidePageHeader>
      <div className="mb-6" data-tour="certificates-intro">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          ISO Compliance Certificates & Document Vault
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Store, audit, and preview digital PDF calibration records. Certificates carry digital
          integrity signatures for verification.
        </p>
      </div>

      {!me ? (
        <PageState variant="loading" title="Loading vault…" />
      ) : !storageEnabled ? (
        // Keep tour anchors present even without vault plan so the product tour never stalls.
        <div
          className="rounded-xl border border-border bg-card px-6 py-14 text-center shadow-xs"
          data-tour="certificates-upload"
        >
          <div data-tour="certificates-vault">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              Certificate vault is not included in your plan
            </p>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
              Contact TrueGage to enable private PDF certificate storage for your company. Once
              enabled, you get 2 GB of vault space for calibration documents.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-tour="certificates-vault">
          <div
            className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs"
            data-tour="certificates-storage"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                File storage
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatSize(usedBytes)} / 2 GB
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  atQuota || nearQuota
                    ? "bg-[color:var(--color-warning)]"
                    : "bg-[color:var(--color-primary)]",
                )}
                style={{ width: `${Math.max(usagePct, usedBytes > 0 ? 4 : 0)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {atQuota
                ? "Quota full — delete files or contact TrueGage."
                : nearQuota
                  ? "Approaching your 2 GB limit."
                  : "Private PDF vault · max 2 MB per file"}
            </p>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search certificate list by File Name, Tag ID, or calibration ID…"
              className="h-11 rounded-lg border-border bg-card pl-10 shadow-xs"
            />
          </div>

          {allowWrite ? (
            <div
              className="rounded-xl border border-border bg-card p-4 shadow-xs"
              data-tour="certificates-upload"
            >
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
                    Upload certificate
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Drop a PDF, then choose which equipment it belongs to.
                  </p>
                </div>
              </div>
              <CertificateUploadControl
                variant="dropzone"
                disabled={atQuota}
                className="[&>div]:py-5"
                onFileSelected={(file) => {
                  setAssignGaugeId("");
                  setEquipmentQuery("");
                  setPendingFile(file);
                  window.setTimeout(() => equipmentSearchRef.current?.focus(), 50);
                }}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-tour="certificates-upload">
              Your role can view certificates but cannot upload.
            </p>
          )}

          {isError && (
            <ErrorBanner
              message={error instanceof Error ? error.message : "Could not load certificates"}
              onRetry={() => void refetch()}
            />
          )}
          {isLoading && <PageState variant="loading" title="Loading certificates…" />}

          {!isLoading && certificates.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-6 py-14 text-center shadow-xs">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">No certificates yet</p>
              <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
                Upload a PDF above, then choose which equipment it belongs to.
              </p>
            </div>
          ) : !isLoading ? (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {certificates.map((c) => {
                const signed = Boolean(c.sha256);
                const eqLabel = c.equipmentTag
                  ? `[${c.equipmentTag}] ${c.equipmentName || "Equipment"}`
                  : c.equipmentName || "Equipment";
                return (
                  <li
                    key={c.id}
                    className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground">
                        {displayCertId(c.id)}
                      </span>
                      {signed ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-success)]/35 bg-[color:var(--color-success)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-success)]">
                          <CheckCircle2 className="h-3 w-3" />
                          Signed
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Stored
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex min-w-0 items-start gap-2.5">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[color:var(--color-destructive)]/15 text-[color:var(--color-destructive)]">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{c.fileName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="text-muted-foreground">Linked Equipment: </span>
                          <span className="font-medium text-foreground">
                            {c.equipmentTag ? (
                              <>
                                <span className="text-[color:var(--color-primary)]">
                                  [{c.equipmentTag}]
                                </span>{" "}
                                {c.equipmentName || eqLabel}
                              </>
                            ) : (
                              eqLabel
                            )}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>By: {c.uploadedBy || "—"}</span>
                      <span>
                        Uploaded:{" "}
                        {c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : "—"}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/80 pt-3">
                      <span className="text-[11px] text-muted-foreground">
                        Size: {formatSize(c.sizeBytes)}
                        {c.calibrationId ? " · Linked cal" : ""}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-[color:var(--color-success)] hover:text-[color:var(--color-success)]"
                          onClick={() => setPreview(c)}
                          aria-label={`Preview ${c.fileName}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-[color:var(--color-info)] hover:text-[color:var(--color-info)]"
                          disabled={downloadingId === c.id}
                          onClick={() => void onDownload(c)}
                          aria-label={`Download ${c.fileName}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {allowWrite ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-[color:var(--color-destructive)] hover:text-[color:var(--color-destructive)]"
                            disabled={deleteMut.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete ${c.fileName}?`)) {
                                deleteMut.mutate(c.id);
                              }
                            }}
                            aria-label={`Delete ${c.fileName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}

      <Dialog
        open={!!pendingFile}
        onOpenChange={(open) => {
          if (!open) closeAssignDialog();
        }}
      >
        <DialogContent className="flex h-[min(90vh,640px)] max-h-[min(90vh,640px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 space-y-1.5 border-b border-border px-6 py-4 text-left">
            <DialogTitle>Link certificate to equipment</DialogTitle>
            <DialogDescription>
              Choose which gauge this PDF belongs to before uploading.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
            <div className="shrink-0 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Selected file
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {pendingFile?.name}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <Label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Equipment*
              </Label>
              <div className="relative shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={equipmentSearchRef}
                  type="search"
                  value={equipmentQuery}
                  disabled={assignBusy}
                  onChange={(e) => setEquipmentQuery(e.target.value)}
                  placeholder="Search by tag or name…"
                  className="tg-focus-ring h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-3 text-sm outline-none disabled:opacity-50"
                />
              </div>

              {selectedEquipment ? (
                <p className="shrink-0 text-xs text-muted-foreground">
                  Selected:{" "}
                  {selectedEquipment.tag ? (
                    <span className="font-medium text-[color:var(--color-primary)]">
                      [{selectedEquipment.tag}]
                    </span>
                  ) : null}{" "}
                  <span className="font-medium text-foreground">{selectedEquipment.name}</span>
                </p>
              ) : (
                <p className="shrink-0 text-xs text-muted-foreground">
                  Select one equipment from the list below.
                </p>
              )}

              <ul
                role="listbox"
                aria-label="Equipment"
                className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card"
              >
                {filteredEquipment.map((o) => {
                  const active = assignGaugeId === o.id;
                  return (
                    <li key={o.id} className="border-b border-border last:border-b-0">
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        disabled={assignBusy}
                        className={cn(
                          "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50",
                          active && "bg-[color:var(--color-primary)]/10",
                        )}
                        onClick={() => setAssignGaugeId(o.id)}
                      >
                        {o.tag ? (
                          <span className="shrink-0 font-medium text-[color:var(--color-primary)]">
                            [{o.tag}]
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate text-foreground">{o.name}</span>
                        {active ? (
                          <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
                {filteredEquipment.length === 0 ? (
                  <li className="px-3.5 py-8 text-center text-sm text-muted-foreground">
                    {equipmentOptions.length === 0
                      ? "No equipment available"
                      : "No matching equipment"}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-6 py-4 sm:space-x-2">
            <Button type="button" variant="outline" disabled={assignBusy} onClick={closeAssignDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={assignBusy || !assignGaugeId}
              onClick={() => void confirmAssignUpload()}
            >
              {assignBusy ? "Uploading…" : "Upload & link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
