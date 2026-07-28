import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { MetricCard } from "@/components/tg/metric-card";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { Button } from "@/components/ui/button";
import {
  Wrench,
  CalendarClock,
  AlertOctagon,
  FileCheck2,
  ClipboardPen,
  Plus,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { statusLabel, type CalStatus, type Equipment } from "@/lib/mock-data";
import { listEquipment, getMe, listAuditEvents, listCertificates, type AuditEventApi } from "@/lib/api";
import {
  complianceScore,
  daysUntilDue,
  parseDate,
  statusBreakdown,
  urgencyBuckets,
} from "@/lib/compliance";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  subMonths,
} from "date-fns";
import { cn } from "@/lib/utils";
import { useMemo, useState, type CSSProperties } from "react";

export const Route = createFileRoute("/workspace/$slug/")({
  head: () => ({ meta: [{ title: "Control Center · TrueGage" }] }),
  component: Dashboard,
});

const STATUS_COLORS: Record<CalStatus, string> = {
  calibrated: "var(--color-success)",
  "due-soon": "var(--color-warning)",
  overdue: "var(--color-destructive)",
  failed: "color-mix(in oklab, var(--color-destructive) 65%, #e879f9)",
  inactive: "var(--color-muted-foreground)",
};

function auditActionLabel(action: string) {
  switch (action) {
    case "equipment.created":
      return "Created equipment";
    case "equipment.updated":
      return "Updated equipment";
    case "equipment.deleted":
      return "Deleted equipment";
    case "calibration.logged":
      return "Logged calibration";
    case "calibration.deleted":
      return "Deleted calibration";
    case "certificate.uploaded":
      return "Uploaded certificate";
    case "certificate.viewed":
      return "Viewed certificate";
    case "certificate.deleted":
      return "Deleted certificate";
    case "odoo.synced":
      return "Imported from Odoo";
    case "report.downloaded":
      return "Downloaded report";
    default:
      return action.replace(/\./g, " ");
  }
}

function formatAuditWhen(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return format(d, "MMM d, yyyy · HH:mm");
  } catch {
    return iso;
  }
}

function formatDashboardBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Dashboard() {
  const { slug } = Route.useParams();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
  });
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 5 * 60_000,
  });
  const storageEnabled = Boolean(me?.storage_enabled);
  const { data: certData } = useQuery({
    queryKey: ["certificates", "dashboard"],
    queryFn: () => listCertificates(),
    enabled: storageEnabled,
    staleTime: 60_000,
  });
  const certCount = certData?.total ?? certData?.items?.length ?? 0;
  const usedBytes = me?.storage_used_bytes ?? 0;
  const quotaBytes = me?.storage_quota_bytes ?? 0;
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: () => listAuditEvents(25),
    refetchInterval: 60_000,
  });
  const auditItems = auditData?.items ?? [];
  const welcomeName = me?.full_name?.trim() || me?.email?.split("@")[0] || null;
  const equipment = data?.items ?? [];
  const readiness = complianceScore(equipment);
  const breakdown = statusBreakdown(equipment);
  const { overdue, critical, normal } = urgencyBuckets(equipment);
  const upcoming = useMemo(() => [...critical, ...normal].slice(0, 6), [critical, normal]);
  const activeCount = equipment.filter((e) => e.status !== "inactive").length;
  const calibratedCount = breakdown.calibrated;
  const failedCount = breakdown.failed;
  const requiresAction = overdue.length;
  const dueIn30 = critical.length + normal.length;
  const todayLabel = format(new Date(), "MMMM d, yyyy");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [breakdownHover, setBreakdownHover] = useState<{
    label: string;
    value: number;
  } | null>(null);
  const isCurrentMonth = isSameMonth(month, new Date());

  const goPrevMonth = () => setMonth((m) => startOfMonth(subMonths(m, 1)));
  const goNextMonth = () => setMonth((m) => startOfMonth(addMonths(m, 1)));
  const goThisMonth = () => setMonth(startOfMonth(new Date()));

  const byStatus = useMemo(
    () =>
      (Object.entries(breakdown) as [CalStatus, number][])
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value, label: statusLabel[name] })),
    [breakdown],
  );

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const duesByDay = useMemo(() => {
    const map = new Map<string, Equipment[]>();
    for (const e of equipment) {
      const next = parseDate(e.nextCalibration);
      if (!next || !isSameMonth(next, month)) continue;
      const key = format(next, "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [equipment, month]);

  const nextDue = upcoming[0];
  const navigate = useNavigate();

  return (
    <AppShell breadcrumbs={[{ label: "Control Center" }]} hidePageHeader>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {welcomeName && (
            <p className="mb-1.5 text-base font-medium text-primary md:text-lg">
              Welcome back, {welcomeName}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              TrueGage Control Center
            </h1>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Live Compliance: {readiness}%
            </span>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Manufacturing calibration, tracking schedules and document readiness. Today is{" "}
            <span className="font-medium text-foreground">{todayLabel}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/workspace/$slug/calibrations" params={{ slug }}>
              <ClipboardPen className="h-3.5 w-3.5" />
              Log Cal Record
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/workspace/$slug/equipment" params={{ slug }} search={{ new: true }}>
              <Plus className="h-3.5 w-3.5" />
              Register Gauge
            </Link>
          </Button>
        </div>
      </div>

      {isError && (
        <ErrorBanner
          message={error instanceof Error ? error.message : "Could not load equipment."}
          onRetry={() => void refetch()}
        />
      )}
      {isLoading && (
        <PageState variant="loading" title="Loading control center…" className="mb-6" />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="dash-cards">
        <MetricCard
          label="Total Equipment Registered"
          value={activeCount}
          delta={`${activeCount} Active Inventory`}
          hint={
            calibratedCount > 0
              ? `Tracking ${calibratedCount} calibrated unit${calibratedCount === 1 ? "" : "s"}`
              : "Add or import equipment to start tracking"
          }
          icon={<Wrench className="h-4 w-4" />}
          tone="info"
          deltaTone="success"
          to="/workspace/$slug/equipment"
          params={{ slug }}
          stagger={0}
        />
        <MetricCard
          label="Scheduled (Due 30 Days)"
          value={dueIn30}
          delta={`${dueIn30} Due Soon`}
          hint={
            nextDue
              ? `Next scheduled is in ${nextDue.days} day${nextDue.days === 1 ? "" : "s"} (${nextDue.name})`
              : "No upcoming dues in the next 30 days"
          }
          icon={<CalendarClock className="h-4 w-4" />}
          tone="warning"
          deltaTone="warning"
          to="/workspace/$slug/equipment"
          params={{ slug }}
          search={{ status: "due-soon" }}
          stagger={1}
        />
        <MetricCard
          label="Out-Of-Calibration & Failures"
          value={requiresAction}
          delta={`${requiresAction} Requires Action`}
          hint={
            failedCount > 0
              ? `Includes ${failedCount} damaged / out-of-tolerance unit${failedCount === 1 ? "" : "s"}`
              : requiresAction > 0
                ? "Overdue calibrations need attention"
                : "All active equipment is within calendar"
          }
          icon={<AlertOctagon className="h-4 w-4" />}
          tone="danger"
          deltaTone="danger"
          to="/workspace/$slug/equipment"
          params={{ slug }}
          search={{ status: "overdue" }}
          stagger={2}
          iconAttention={requiresAction > 0}
        />
        <MetricCard
          label="Certificates Handled"
          value={storageEnabled ? certCount : "—"}
          delta={
            storageEnabled
              ? certCount === 0
                ? "Vault ready · no PDFs yet"
                : `${certCount} PDF${certCount === 1 ? "" : "s"} in vault`
              : "Not in your plan"
          }
          hint={
            storageEnabled
              ? quotaBytes > 0
                ? `Storage ${formatDashboardBytes(usedBytes)} of 2 GB`
                : "Private PDF certificate vault"
              : "Contact TrueGage to enable certificate storage"
          }
          icon={<FileCheck2 className="h-4 w-4" />}
          tone={storageEnabled ? "success" : "default"}
          deltaTone={storageEnabled ? (certCount > 0 ? "success" : "default") : "warning"}
          to="/workspace/$slug/certificates"
          params={{ slug }}
          stagger={3}
        />
      </div>

      {overdue.length > 0 && (
        <div className="tg-rise tg-shimmer mt-6 overflow-hidden rounded-xl border border-destructive/45 bg-[color-mix(in_oklab,var(--color-destructive)_9%,transparent)] shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/30 px-5 py-3">
            <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" />
              Urgent Compliance Action Required ({overdue.length})
            </h2>
            <Link to="/workspace/$slug/calibrations" params={{ slug }} className="text-xs font-medium text-destructive hover:underline">
              Open schedules →
            </Link>
          </div>
          <ul className="divide-y divide-destructive/20">
            {overdue.slice(0, 5).map((e, i) => {
              const next = parseDate(e.nextCalibration);
              return (
                <li
                  key={e.id}
                  className="tg-row-in flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-destructive/5"
                  style={{ "--stagger": i } as CSSProperties}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/workspace/$slug/equipment/$id"
                      params={{ slug, id: e.id }}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {e.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{e.tag}</span>
                      {" · "}Dept: {e.department || "—"}
                      {" · "}Failed Spec:{" "}
                      <span className={e.status === "failed" ? "font-semibold text-destructive" : ""}>
                        {e.status === "failed" ? "YES" : "NO"}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="rounded-md bg-destructive px-2.5 py-1 text-xs font-semibold text-white">
                      {Math.abs(e.days)}d Overdue
                    </div>
                    <div className="mt-1 text-[11px] font-medium text-destructive">
                      Due: {next ? format(next, "yyyy-MM-dd") : "—"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-stretch">
        {/* Left: calendar + upcoming */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          <section className="tg-rise tg-panel tg-panel-hover rounded-xl border border-border bg-card p-5 shadow-xs" style={{ animationDelay: "120ms" } as CSSProperties}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Calibration Calendar
                </h2>
                <p className="font-display text-xl font-semibold text-foreground">
                  {format(month, "MMMM yyyy")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-md border border-border bg-surface/60 p-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={goPrevMonth}
                    aria-label="Previous month"
                    title="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={goThisMonth}
                    disabled={isCurrentMonth}
                    title="Jump to this month"
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={goNextMonth}
                    aria-label="Next month"
                    title="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <Link to="/workspace/$slug/calibrations" params={{ slug }} className="text-xs font-medium text-primary hover:underline">
                  View schedules →
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1.5">
              {calendarDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dues = duesByDay.get(key) ?? [];
                const inMonth = isSameMonth(day, month);
                const isToday = isSameDay(day, new Date());
                return (
                  <div
                    key={key}
                    className={cn(
                      "min-h-[4.5rem] rounded-lg border p-1.5 text-left transition-colors duration-200 sm:min-h-[5.25rem]",
                      inMonth
                        ? "border-border/60 bg-surface-2/50 hover:border-primary/30 hover:bg-primary/5"
                        : "border-transparent bg-transparent opacity-40",
                      isToday && "border-primary bg-primary/5 ring-1 ring-primary/40",
                    )}
                  >
                    <div
                      className={cn(
                        "text-[11px] font-semibold",
                        isToday ? "text-primary" : "text-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dues.slice(0, 2).map((e) => {
                        const d = daysUntilDue(e);
                        const overdueDay = d !== null && d < 0;
                        return (
                          <Link
                            key={e.id}
                            to="/workspace/$slug/equipment/$id"
                            params={{ slug, id: e.id }}
                            className={cn(
                              "block truncate rounded-sm px-1 py-0.5 text-[9px] font-semibold leading-tight",
                              overdueDay
                                ? "bg-destructive/20 text-destructive"
                                : "bg-warning/20 text-warning",
                            )}
                            title={`${e.tag} · ${e.name}`}
                          >
                            {e.tag}
                          </Link>
                        );
                      })}
                      {dues.length > 2 && (
                        <div className="px-1 text-[9px] text-muted-foreground">+{dues.length - 2}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-warning" /> Due soon (0–30 days)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive" /> Overdue / Out-of-Spec
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border-2 border-primary" /> Today ({format(new Date(), "MMM d, yyyy")})
              </span>
            </div>
          </section>

          <section className="tg-rise flex flex-col rounded-xl border border-border bg-card shadow-xs" style={{ animationDelay: "180ms" }}>
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Upcoming Schedules (Next 30 Days)
              </h2>
              <Link to="/workspace/$slug/calibrations" params={{ slug }} className="text-xs font-medium text-primary hover:underline">
                View All →
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <PageState
                variant="empty"
                title="No schedules in the next 30 days"
                description="When equipment has upcoming due dates, they will appear here."
                action={{
                  label: "Open calibrations",
                  onClick: () => void navigate({ to: "/workspace/$slug/calibrations", params: { slug } }),
                }}
                className="m-4 border-0 bg-transparent py-8"
              />
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((e, i) => {
                  const next = parseDate(e.nextCalibration);
                  const urgency = Math.max(8, Math.min(100, ((30 - e.days) / 30) * 100));
                  const urgent = e.days <= 7;
                  return (
                    <li
                      key={e.id}
                      className="tg-row-in px-5 py-4 transition-colors hover:bg-muted/30"
                      style={{ "--stagger": i } as CSSProperties}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to="/workspace/$slug/equipment/$id"
                            params={{ slug, id: e.id }}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            <span className="font-mono text-xs text-muted-foreground">{e.tag}</span>{" "}
                            {e.name}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">
                            In {e.days} day{e.days === 1 ? "" : "s"}
                            {next ? ` (${format(next, "yyyy-MM-dd")})` : ""}
                            {e.owner ? ` · Assigned: ${e.owner}` : ""}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase",
                            urgent
                              ? "bg-destructive/15 text-destructive"
                              : "bg-primary/15 text-primary",
                          )}
                        >
                          {urgent ? "Critical" : "Scheduled"}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full origin-left rounded-full transition-all duration-700 ease-out motion-reduce:transition-none",
                            urgent ? "bg-destructive" : "bg-primary",
                          )}
                          style={{ width: `${urgency}%`, transitionDelay: `${i * 60}ms` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Right: compact breakdown + audit — height locked to left column (stops at Upcoming) */}
        <div className="flex min-h-0 flex-col gap-4 xl:h-0 xl:min-h-full">
          <section className="tg-rise tg-panel tg-panel-hover shrink-0 rounded-xl border border-border bg-card p-5 shadow-xs" style={{ animationDelay: "220ms" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Equipment Breakdown
              </h2>
              <span className="text-xs text-muted-foreground">{equipment.length} items</span>
            </div>
            {byStatus.length === 0 ? (
              <PageState
                variant="empty"
                title="No equipment yet"
                description="Add equipment to see status breakdown."
                className="border-0 bg-transparent py-6"
              />
            ) : (
              <>
                <div className="mb-1 flex h-7 items-center justify-center">
                  {breakdownHover ? (
                    <div className="rounded-md border border-border bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-md">
                      <span className="font-medium">{breakdownHover.label}</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="font-semibold tabular-nums">{breakdownHover.value}</span>
                    </div>
                  ) : null}
                </div>
                <div className="relative mx-auto h-44 w-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={byStatus}
                        dataKey="value"
                        innerRadius={52}
                        outerRadius={72}
                        paddingAngle={2}
                        stroke="var(--color-card)"
                        strokeWidth={3}
                        onMouseLeave={() => setBreakdownHover(null)}
                      >
                        {byStatus.map((row) => (
                          <Cell
                            key={row.name}
                            fill={STATUS_COLORS[row.name]}
                            className="cursor-pointer outline-none"
                            onMouseEnter={() =>
                              setBreakdownHover({ label: row.label, value: row.value })
                            }
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="metric-value text-2xl font-semibold text-foreground">
                      {equipment.length}
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Total Items
                    </div>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {byStatus.map((row) => {
                    const pct = equipment.length
                      ? Math.round((row.value / equipment.length) * 100)
                      : 0;
                    return (
                      <li key={row.name} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: STATUS_COLORS[row.name] }}
                        />
                        <span className="flex-1 text-muted-foreground">{row.label}</span>
                        <span className="font-semibold text-foreground">
                          {row.value}{" "}
                          <span className="font-normal text-muted-foreground">({pct}%)</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <section className="tg-rise flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs" style={{ animationDelay: "280ms" }}>
            <div className="shrink-0 border-b border-border px-5 py-3.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Audit Log / Activity Feed
              </h2>
            </div>
            {auditLoading ? (
              <div className="flex flex-1 items-center px-2">
                <PageState
                  variant="loading"
                  title="Loading activity…"
                  className="w-full border-0 bg-transparent py-8"
                />
              </div>
            ) : auditItems.length === 0 ? (
              <div className="flex flex-1 items-center px-2">
                <PageState
                  variant="empty"
                  title="No audit events yet"
                  description="Create or edit equipment, or log a calibration — activity will show up here."
                  className="w-full border-0 bg-transparent py-8"
                />
              </div>
            ) : (
              <ul className="tg-scrollbar min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                {auditItems.map((evt: AuditEventApi) => (
                  <li key={evt.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {auditActionLabel(evt.action)}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {evt.target_name || "—"}
                          {evt.detail ? ` · ${evt.detail}` : ""}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {evt.user_name || "User"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {formatAuditWhen(evt.timestamp)}
                      </div>
                    </div>
                    {evt.target_type === "equipment" && evt.target_id ? (
                      <Link
                        to="/workspace/$slug/equipment/$id"
                        params={{ slug, id: evt.target_id }}
                        className="mt-1.5 inline-block text-[11px] font-medium text-primary hover:underline"
                      >
                        Open equipment →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
