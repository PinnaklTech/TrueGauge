import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { StatusBadge } from "@/components/tg/status-badge";
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
  updateEquipment,
  type AppCalibration,
  type AppCertificate,
  type EquipmentPayload,
} from "@/lib/api";
import { canDelete, canWrite } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { format, differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { ArrowLeft, Edit3, Eye, FileText, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CertificatePreviewDialog } from "@/components/tg/certificate-preview-dialog";
import { CertificateUploadControl } from "@/components/tg/certificate-upload-control";

function parseDate(value: string) {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

export const Route = createFileRoute("/workspace/$slug/equipment/$id")({
  head: () => ({ meta: [{ title: "Equipment · TrueGage" }] }),
  // Fetch on the client only — SSR has no localStorage auth token.
  component: EquipmentDetail,
});

function EquipmentDetail() {
  const { slug, id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<AppCertificate | null>(null);

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
          <Link to="/workspace/$slug/equipment" params={{ slug }} className="text-[color:var(--color-primary)]">
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
      // Navigate first — don't wait on list refetches
      await navigate({ to: "/workspace/$slug/equipment", params: { slug }, replace: true });
      void queryClient.invalidateQueries({ queryKey: ["equipment"] });
      void queryClient.invalidateQueries({ queryKey: ["calibrations"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <AppShell
      breadcrumbs={[{ label: "Equipment", to: `/workspace/${slug}/equipment` }, { label: item.tag || item.name }]}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Link
            to="/workspace/$slug/equipment"
            params={{ slug }}
            className="mt-1 grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{item.tag}</span>
              <StatusBadge status={item.status} />
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {item.source === "odoo" ? "Imported from Odoo" : "Local"}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{item.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {item.manufacturer || "—"} · {item.model || "—"} · {item.serial || "—"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {allowWrite && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Edit3 className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          {allowDelete && (
            <Button variant="outline" size="sm" onClick={() => void onDelete()}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          )}
          {allowWrite && (
            <Button size="sm" asChild>
              <Link to="/workspace/$slug/calibrations" params={{ slug }} search={{ tab: "log", equipment: item.id }}>
                <Wrench className="mr-1.5 h-3.5 w-3.5" />
                Log calibration
              </Link>
            </Button>
          )}
        </div>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold text-foreground">Calibration timeline</h2>
              <p className="text-xs text-muted-foreground">History of verification runs for this gauge</p>
            </div>
            <ol className="relative px-5 py-4">
              <div className="absolute left-[30px] top-4 bottom-4 w-px bg-border" />
              {history.map((c) => (
                <li key={c.id} className="relative flex gap-4 py-3">
                  <div
                    className={`relative z-10 mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-4 ring-card ${
                      c.result === "pass"
                        ? "bg-[color:var(--color-success)]"
                        : c.result === "fail"
                          ? "bg-[color:var(--color-destructive)]"
                          : "bg-[color:var(--color-warning)]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {c.type === "external" ? "External calibration" : "Internal calibration"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {format(new Date(c.date), "MMM d, yyyy")}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.result}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      By {c.technician || "—"} · {c.provider || "—"}
                    </p>
                    {c.notes && (
                      <p className="mt-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground">
                        {c.notes}
                      </p>
                    )}
                    {(c.certificateNo || c.dueDate) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {c.certificateNo && (
                          <span className="font-mono text-muted-foreground">{c.certificateNo}</span>
                        )}
                        {c.dueDate && (
                          <span className="text-muted-foreground">
                            Next due {format(new Date(c.dueDate), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {history.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No calibration history yet.
                  {allowWrite && (
                    <>
                      {" "}
                      <Link
                        to="/workspace/$slug/calibrations"
                        params={{ slug }}
                        search={{ tab: "log", equipment: item.id }}
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

          <div className="rounded-xl border border-border bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold text-foreground">Documents</h2>
              {storageEnabled && allowWrite ? (
                <CertificateUploadControl
                  compact
                  equipmentId={item.id}
                  onUploaded={async () => {
                    await refetchCerts();
                    await queryClient.invalidateQueries({ queryKey: ["certificates"] });
                    await queryClient.invalidateQueries({ queryKey: ["me"] });
                  }}
                />
              ) : null}
            </div>
            {!storageEnabled ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                Certificate vault is not included in your plan. Contact TrueGage to enable document
                storage.
              </p>
            ) : (
            <ul className="divide-y divide-border">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{c.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.createdAt
                        ? `Uploaded ${format(new Date(c.createdAt), "MMM d, yyyy")}`
                        : "Uploaded"}
                      {c.uploadedBy ? ` · ${c.uploadedBy}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setPreview(c)}
                    aria-label={`View ${c.fileName}`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  {allowWrite ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (!window.confirm(`Delete ${c.fileName}?`)) return;
                        void deleteCertificate(c.id)
                          .then(async () => {
                            toast.success("Certificate deleted");
                            await refetchCerts();
                            await queryClient.invalidateQueries({ queryKey: ["certificates"] });
                            await queryClient.invalidateQueries({ queryKey: ["me"] });
                          })
                          .catch((e) =>
                            toast.error(e instanceof Error ? e.message : "Delete failed"),
                          );
                      }}
                      aria-label={`Delete ${c.fileName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
        </div>

        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Calibration dates
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Previous
                </div>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {last ? format(last, "MMM d, yyyy") : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Next
                </div>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {next ? format(next, "MMM d, yyyy") : "—"}
                </div>
              </div>
            </div>

            <div
              className={`mt-3 text-sm ${
                days !== null && days < 0
                  ? "text-[color:var(--color-destructive)]"
                  : days !== null && days <= 14
                    ? "text-[color:var(--color-warning)]"
                    : "text-muted-foreground"
              }`}
            >
              {days === null
                ? "No due date set"
                : days < 0
                  ? `${Math.abs(days)} days overdue`
                  : `Due in ${days} day${days === 1 ? "" : "s"}`}
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[color:var(--color-primary)]"
                style={{
                  width:
                    days === null
                      ? "0%"
                      : `${Math.min(100, Math.max(6, ((item.frequencyDays - Math.max(0, days)) / item.frequencyDays) * 100))}%`,
                }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Every {item.frequencyDays} day{item.frequencyDays === 1 ? "" : "s"}
            </div>
          </div>

          <DetailBlock title="Identity">
            <DetailRow label="Tag" value={<span className="font-mono">{item.tag || "—"}</span>} />
            <DetailRow label="Serial" value={<span className="font-mono">{item.serial || "—"}</span>} />
            <DetailRow label="Category" value={item.category || "—"} />
            <DetailRow label="Manufacturer" value={item.manufacturer || "—"} />
            <DetailRow label="Model" value={item.model || "—"} />
          </DetailBlock>

          <DetailBlock title="Location & Ownership">
            <DetailRow label="Department" value={item.department || "—"} />
            <DetailRow label="Location" value={item.location || "—"} />
            <DetailRow label="Owner" value={item.owner || "—"} />
          </DetailBlock>
        </aside>
      </div>

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

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </div>
  );
}
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
