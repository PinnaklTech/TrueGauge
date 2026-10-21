import { StatusBadge } from "@/components/tg/status-badge";
import type { CalStatus } from "@/lib/mock-data";
import { useWorkspaceFormat } from "@/lib/format-context";
import { cn } from "@/lib/utils";

type Props = {
  tag: string;
  name: string;
  status: CalStatus;
  source?: "local" | "odoo";
  manufacturer?: string;
  model?: string;
  serial?: string;
  lastDate: Date | null;
  nextDate: Date | null;
  daysUntilDue: number | null;
  frequencyDays: number;
  /** Larger hero for shop-floor / mobile */
  compact?: boolean;
  className?: string;
};

export function EquipmentDetailHero({
  tag,
  name,
  status,
  source,
  manufacturer,
  model,
  serial,
  lastDate,
  nextDate,
  daysUntilDue,
  frequencyDays,
  compact,
  className,
}: Props) {
  const { formatDate } = useWorkspaceFormat();
  const dueTone =
    daysUntilDue === null
      ? "text-muted-foreground"
      : daysUntilDue < 0
        ? "text-[color:var(--color-destructive)]"
        : daysUntilDue <= 14
          ? "text-[color:var(--color-warning)]"
          : "text-foreground";

  const dueLabel =
    daysUntilDue === null
      ? "No due date set"
      : daysUntilDue < 0
        ? `${Math.abs(daysUntilDue)} days overdue`
        : daysUntilDue === 0
          ? "Due today"
          : `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;

  const progressWidth =
    daysUntilDue === null
      ? "0%"
      : `${Math.min(100, Math.max(6, ((frequencyDays - Math.max(0, daysUntilDue)) / Math.max(1, frequencyDays)) * 100))}%`;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-xs",
        compact ? "p-4" : "p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{tag || "—"}</span>
        <StatusBadge status={status} className={compact ? "px-2.5 py-1 text-sm" : undefined} />
        {source ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {source === "odoo" ? "Odoo" : "Local"}
          </span>
        ) : null}
      </div>
      <h1
        className={cn(
          "mt-2 font-semibold tracking-tight text-foreground",
          compact ? "text-xl leading-snug" : "text-2xl",
        )}
      >
        {name}
      </h1>
      {!compact && (
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[manufacturer, model, serial].filter(Boolean).join(" · ") || "—"}
        </p>
      )}

      <div className={cn("mt-4 grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
        <div className="rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Last calibration
          </div>
          <div className={cn("mt-1 font-semibold text-foreground", compact ? "text-lg" : "text-base")}>
            {lastDate ? formatDate(lastDate) : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Next due
          </div>
          <div className={cn("mt-1 font-semibold text-foreground", compact ? "text-lg" : "text-base")}>
            {nextDate ? formatDate(nextDate) : "—"}
          </div>
        </div>
      </div>

      <p className={cn("mt-3 font-medium", dueTone, compact ? "text-base" : "text-sm")}>{dueLabel}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[color:var(--color-primary)]"
          style={{ width: progressWidth }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Every {frequencyDays} day{frequencyDays === 1 ? "" : "s"}
      </p>
    </div>
  );
}
