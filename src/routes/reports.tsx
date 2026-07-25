import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { Button } from "@/components/ui/button";
import { listCalibrations, listEquipment } from "@/lib/api";
import {
  categoryCompliance,
  complianceScore,
  daysUntilDue,
  statusBreakdown,
} from "@/lib/compliance";
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Info,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Equipment } from "@/lib/mock-data";
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

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports · True Gauge" }] }),
  component: ReportsPage,
});

function ReportsPage() {
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
  const equipment = data?.items ?? [];
  const calibrations = calData?.items ?? [];
  const readiness = complianceScore(equipment);
  const breakdown = statusBreakdown(equipment);
  const categories = categoryCompliance(equipment);
  const active = equipment.filter((e) => e.status !== "inactive");
  const compliantUnits = active.filter((e) => e.status === "calibrated").length;
  const overdueUnits = breakdown.overdue + breakdown.failed;
  const decommissioned = breakdown.inactive;
  const [reportType, setReportType] = useState<"overdue" | "due" | "inventory">("inventory");
  const [formatPreset, setFormatPreset] = useState<"csv" | "xlsx" | "pdf">("csv");
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
    if (reportType === "inventory") return equipment;
    if (reportType === "overdue") {
      return equipment.filter((e) => {
        const days = daysUntilDue(e);
        return e.status === "overdue" || e.status === "failed" || (days !== null && days < 0);
      });
    }
    // due within 30 days
    return equipment.filter((e) => {
      const days = daysUntilDue(e);
      return days !== null && days >= 0 && days <= 30;
    });
  }, [equipment, reportType]);

  const exportCsv = (rows: Equipment[]) => {
    const dataRows = [
      ["tag", "name", "category", "department", "status", "next_calibration"],
      ...rows.map((e) => [
        e.tag,
        e.name,
        e.category,
        e.department,
        e.status,
        e.nextCalibration,
      ]),
    ];
    const csv = dataRows
      .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `true-gauge-${reportType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`CSV downloaded (${rows.length} rows)`);
  };

  const onDownload = () => {
    if (formatPreset !== "csv") {
      toast.message("XLSX and PDF export are not available yet. Use CSV for live equipment data.");
      return;
    }
    if (equipment.length === 0) {
      toast.error("No equipment to export. Add or import equipment first.");
      return;
    }
    exportCsv(exportRows);
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
              No equipment in True Gauge yet. Readiness is calculated from calibrated vs active assets
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
              <li className="flex items-start gap-3 text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium text-foreground">Certificate / NIST traceability</div>
                  <div className="text-xs">
                    Not available yet — certificate storage API is not connected. This check will
                    appear when certificates are stored in True Gauge.
                  </div>
                </div>
              </li>
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
                to="/calibrations"
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

      <div className="mt-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Export live equipment
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Downloads current equipment from the API. For verification history, open{" "}
          <Link to="/calibrations" search={{ tab: "history" }} className="text-primary hover:underline">
            calibration history
          </Link>
          .
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-sm" htmlFor="report-type">
            <span className="text-xs text-muted-foreground">Report Type</span>
            <select
              id="report-type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as typeof reportType)}
              className="tg-select"
            >
              <option value="inventory">Full inventory ({equipment.length})</option>
              <option value="overdue">Overdue / failed ({overdueCount})</option>
              <option value="due">Due within 30 days ({dueSoonCount})</option>
            </select>
          </label>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Format</span>
            <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
              {(["csv", "xlsx", "pdf"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormatPreset(f)}
                  className={cn(
                    "flex-1 rounded-[5px] px-2 py-1.5 text-xs font-semibold uppercase",
                    formatPreset === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Button className="mt-4 w-full sm:w-auto" onClick={onDownload} disabled={isLoading}>
          <Download className="mr-1.5 h-4 w-4" /> Download ({exportRows.length} rows)
        </Button>
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
