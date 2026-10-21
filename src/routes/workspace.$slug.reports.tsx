import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { Button } from "@/components/ui/button";
import {
  listCalibrations,
  listCertificates,
  listEquipment,
  listReportHistory,
  downloadReport,
  downloadStoredReport,
  type ReportType,
} from "@/lib/api";
import {
  categoryCompliance,
  complianceScore,
  daysUntilDue,
  statusBreakdown,
} from "@/lib/compliance";
import { useWorkspaceFormat } from "@/lib/format-context";
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Info,
  FileText,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  eachMonthOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/workspace/$slug/reports")({
  head: () => ({ meta: [{ title: "Reports · TrueGage" }] }),
  component: ReportsPage,
});

const REPORT_TYPE_LABEL: Record<string, string> = {
  compliance: "Compliance summary",
  inventory: "Full inventory",
  overdue: "Overdue / failed",
  due: "Due within 30 days",
};

function ReportsPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const { formatDateTime } = useWorkspaceFormat();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
  });
  const {
    data: calData,
    isLoading: calLoading,
    isError: calError,
    refetch: refetchCal,
  } = useQuery({
    queryKey: ["calibrations"],
    queryFn: () => listCalibrations(),
  });
  const { data: certData } = useQuery({
    queryKey: ["certificates"],
    queryFn: () => listCertificates(),
  });
  const {
    data: history = [],
    isLoading: historyLoading,
    isError: historyError,
    error: historyErr,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ["report-history"],
    queryFn: () => listReportHistory(),
  });
  const equipment = data?.items ?? [];
  const calibrations = calData?.items ?? [];
  const certificates = certData?.items ?? [];
  const readiness = complianceScore(equipment);
  const breakdown = statusBreakdown(equipment);
  const categories = categoryCompliance(equipment);
  const active = equipment.filter((e) => e.status !== "inactive");
  const compliantUnits = active.filter((e) => e.status === "calibrated").length;
  const overdueUnits = breakdown.overdue + breakdown.failed;
  const decommissioned = breakdown.inactive;
  const equipmentWithCert = useMemo(() => {
    const ids = new Set(certificates.map((c) => c.equipmentId));
    return active.filter((e) => ids.has(e.id)).length;
  }, [active, certificates]);
  const [reportType, setReportType] = useState<ReportType>("compliance");
  const [downloading, setDownloading] = useState(false);
  const [historyDownloadingId, setHistoryDownloadingId] = useState<number | null>(null);
  const overdueCount = useMemo(
    () =>
      equipment.filter((e) => {
        const days = daysUntilDue(e);
        return e.status === "overdue" || e.status === "failed" || (days !== null && days < 0);
      }).length,
    [equipment],
  );
  const dueSoonCount = useMemo(
    () =>
      equipment.filter((e) => {
        const days = daysUntilDue(e);
        return days !== null && days >= 0 && days <= 30;
      }).length,
    [equipment],
  );

  const trendMonths = useMemo(() => {
    const end = endOfMonth(new Date());
    const start = startOfMonth(subMonths(end, 5));
    const months = eachMonthOfInterval({ start, end });
    const counts = new Map(months.map((m) => [format(m, "yyyy-MM"), 0]));
    for (const c of calibrations) {
      try {
        const key = format(parseISO(c.date), "yyyy-MM");
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      } catch {
        /* skip bad dates */
      }
    }
    return months.map((m) => {
      const key = format(m, "yyyy-MM");
      return {
        key,
        label: format(m, "MMM"),
        fullLabel: format(m, "MMMM yyyy"),
        count: counts.get(key) ?? 0,
      };
    });
  }, [calibrations]);

  const trendTotal = useMemo(
    () => trendMonths.reduce((sum, m) => sum + m.count, 0),
    [trendMonths],
  );
  const trendMax = useMemo(
    () => Math.max(1, ...trendMonths.map((m) => m.count)),
    [trendMonths],
  );

  const exportRows = useMemo(() => {
    if (reportType === "inventory" || reportType === "compliance") return equipment;
    if (reportType === "overdue") {
      return equipment.filter((e) => {
        const days = daysUntilDue(e);
        return e.status === "overdue" || e.status === "failed" || (days !== null && days < 0);
      });
    }
    return equipment.filter((e) => {
      const days = daysUntilDue(e);
      return days !== null && days >= 0 && days <= 30;
    });
  }, [equipment, reportType]);

  const onDownload = async () => {
    if (equipment.length === 0 && reportType !== "compliance") {
      toast.error("No equipment to export. Add or import equipment first.");
      return;
    }
    setDownloading(true);
    try {
      const result = await downloadReport({ type: reportType, format: "pdf" });
      toast.success(
        `PDF ready · ${result.filename}` +
          (result.rowCount ? ` · ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}` : ""),
      );
      await queryClient.invalidateQueries({ queryKey: ["report-history"] });
      await refetchHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const onDownloadStored = async (id: number) => {
    setHistoryDownloadingId(id);
    try {
      const result = await downloadStoredReport(id);
      toast.success(`Downloaded ${result.filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setHistoryDownloadingId(null);
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: "Reports & Audits" }]} hidePageHeader>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Metrology Analytics & Compliance Reports
        </h1>
        {equipment.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
            <ShieldCheck className="h-3 w-3" /> Live equipment data
          </span>
        )}
      </div>

      {isLoading && (
        <PageState variant="loading" title="Loading equipment from API…" className="mb-4" />
      )}
      {isError && (
        <ErrorBanner
          message={
            error instanceof Error ? error.message : "Could not load equipment. Is the API running?"
          }
          onRetry={() => void refetch()}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            ISO 9001 Audit Readiness Index
          </h2>
          {equipment.length === 0 ? (
            <EmptyNote>
              No equipment in TrueGage yet. Readiness is calculated from calibrated vs active assets
              once you add equipment or import from Odoo.
            </EmptyNote>
          ) : (
            <>
              <div className="mt-3 flex items-end gap-3">
                <div className="metric-value font-display text-5xl font-semibold text-foreground">
                  {readiness}%
                </div>
                <p className="mb-1 text-sm text-muted-foreground">
                  of active equipment currently marked calibrated.
                </p>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${readiness}%` }} />
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-xs">
                <span>
                  Compliant Units:{" "}
                  <strong className="text-foreground">
                    {compliantUnits}/{active.length}
                  </strong>
                </span>
                <span className="text-destructive">
                  Overdue / Failed: <strong>{overdueUnits}</strong>
                </span>
                <span className="text-muted-foreground">
                  Inactive: <strong className="text-foreground">{decommissioned}</strong>
                </span>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Compliance Checks
          </h2>
          {equipment.length === 0 ? (
            <EmptyNote>
              Checks appear after equipment is loaded. Overdue status comes from each asset’s next
              calibration date and status.
            </EmptyNote>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              <Benchmark
                ok={overdueUnits === 0}
                label="Overdue / failed gauges"
                detail={
                  overdueUnits === 0
                    ? "No devices are overdue or failed right now"
                    : `${overdueUnits} device(s) need calibration action`
                }
              />
              <Benchmark
                ok={compliantUnits > 0}
                label="Calibrated coverage"
                detail={`${compliantUnits} of ${active.length} active assets are calibrated`}
              />
              <Benchmark
                ok={certificates.length > 0 && equipmentWithCert > 0}
                label="Certificate / NIST traceability"
                detail={
                  certificates.length === 0
                    ? "No PDF certificates uploaded yet — add them in Certificates or on equipment"
                    : `${certificates.length} PDF(s) on file covering ${equipmentWithCert} of ${active.length} active assets`
                }
              />
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Calibrations Logged Trend
            </h2>
            {!calLoading && !calError && (
              <span className="text-xs text-muted-foreground">
                {trendTotal} in last 6 months
              </span>
            )}
          </div>
          {calLoading ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">Loading trend…</p>
          ) : calError ? (
            <div className="mt-4">
              <ErrorBanner
                message="Could not load calibration history for the trend chart."
                onRetry={() => void refetchCal()}
              />
            </div>
          ) : trendTotal === 0 ? (
            <EmptyNote>
              No calibration runs logged in the last 6 months.{" "}
              <Link
                to="/workspace/$slug/calibrations"
                params={{ slug }}
                search={{ tab: "log" }}
                className="text-primary hover:underline"
              >
                Log a calibration
              </Link>{" "}
              to start the trend.
            </EmptyNote>
          ) : (
            <div className="mt-2 h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendMonths} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--color-border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    domain={[0, Math.ceil(trendMax * 1.15) || 1]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: "color-mix(in oklab, var(--color-primary) 8%, transparent)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as {
                        fullLabel?: string;
                        count?: number;
                      };
                      return (
                        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                          <span className="font-medium">{row.fullLabel}</span>
                          <span className="text-muted-foreground">: </span>
                          <span className="font-semibold tabular-nums">{row.count}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            record{(row.count ?? 0) === 1 ? "" : "s"}
                          </span>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Logged"
                    fill="var(--color-primary)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Category Compliance Rates
          </h2>
          {categories.length === 0 ? (
            <EmptyNote>
              No categories to chart. Add equipment with a category, or import from Odoo.
            </EmptyNote>
          ) : (
            <ul className="mt-4 space-y-3">
              {categories.map((c) => (
                <li key={c.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-muted-foreground">
                      {c.calibrated}/{c.total} Calibrated ({c.pct}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        c.pct >= 90 ? "bg-success" : c.pct >= 70 ? "bg-warning" : "bg-destructive",
                      )}
                      style={{ width: `${c.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div
        className="mt-4 rounded-xl border border-border bg-card p-5 shadow-xs"
        data-tour="reports-generate"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Generate &amp; download report
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Thetruegage builds an audit-ready PDF from live workspace data. The file is named after its
          Report ID (for example TG-RPT-20261021-0142.pdf). The last 3 PDFs are kept here for
          re-download.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-sm" htmlFor="report-type">
            <span className="text-xs text-muted-foreground">Report Type</span>
            <select
              id="report-type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="tg-select"
            >
              <option value="compliance">Compliance summary ({readiness}% ready)</option>
              <option value="inventory">Full inventory ({equipment.length})</option>
              <option value="overdue">Overdue / failed ({overdueCount})</option>
              <option value="due">Due within 30 days ({dueSoonCount})</option>
            </select>
          </label>
          <div className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Format</span>
            <div className="flex h-10 items-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-foreground">
              PDF
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface/40 px-3 py-2.5 text-xs text-muted-foreground">
          PDF includes readiness %, overdue / due-soon counts, and an equipment detail table
          {reportType === "compliance"
            ? " for the full inventory."
            : ` filtered to this report (${exportRows.length} row${exportRows.length === 1 ? "" : "s"}).`}
        </div>
        <Button
          className="mt-4 w-full sm:w-auto"
          onClick={() => void onDownload()}
          disabled={isLoading || downloading}
        >
          <Download className="mr-1.5 h-4 w-4" />
          {downloading
            ? "Generating…"
            : `Download PDF (${exportRows.length})`}
        </Button>
      </div>

      <div
        className="mt-4 rounded-xl border border-border bg-card p-5 shadow-xs"
        data-tour="reports-history"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Previously generated
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Up to 3 recent PDFs stored in your workspace. Older ones are removed automatically.
        </p>
        {historyLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading history…</p>
        ) : historyError ? (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-sm text-destructive">
            <div>
              Could not load report history
              {historyErr instanceof Error ? `: ${historyErr.message}` : "."}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void refetchHistory()}
            >
              Retry
            </Button>
          </div>
        ) : history.length === 0 ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-dashed border-border bg-surface/50 px-3 py-4 text-sm text-muted-foreground">
            <FileText className="mt-0.5 h-4 w-4 shrink-0" />
            <div>No reports yet. Generate a PDF above to see it listed here.</div>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{item.filename}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {REPORT_TYPE_LABEL[item.reportType] ?? item.reportType}
                    {" · "}
                    {item.generatedByName || "User"}
                    {item.generatedByRole ? ` (${item.generatedByRole})` : ""}
                    {" · "}
                    {formatDateTime(item.createdAt)}
                    {item.rowCount
                      ? ` · ${item.rowCount} row${item.rowCount === 1 ? "" : "s"}`
                      : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={historyDownloadingId === item.id}
                  onClick={() => void onDownloadStored(item.id)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {historyDownloadingId === item.id ? "Downloading…" : "Download"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-2 rounded-lg border border-dashed border-border bg-surface/50 px-3 py-4 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>{children}</div>
    </div>
  );
}

function Benchmark({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
      )}
      <div>
        <div className="font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </li>
  );
}
