import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/tg/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { AppEquipment } from "@/lib/api";
import { parseDate } from "@/lib/compliance";
import { useWorkspaceFormat } from "@/lib/format-context";
import { cn } from "@/lib/utils";
import { differenceInCalendarDays } from "date-fns";
import { ChevronRight } from "lucide-react";

type Props = {
  item: AppEquipment;
  slug: string;
  /** When true, card is for multi-select (print labels), not navigation */
  allowSelect?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
};

export function EquipmentMobileCard({
  item,
  slug,
  allowSelect,
  selected,
  onToggleSelect,
}: Props) {
  const { formatDate } = useWorkspaceFormat();
  const next = parseDate(item.nextCalibration);
  const days = next ? differenceInCalendarDays(next, new Date()) : null;
  const dueText =
    days === null
      ? "No due date"
      : days < 0
        ? `${Math.abs(days)}d overdue`
        : days === 0
          ? "Due today"
          : `Due in ${days}d`;
  const dueClass =
    days === null
      ? "text-muted-foreground"
      : days < 0
        ? "text-[color:var(--color-destructive)]"
        : days <= 14
          ? "text-[color:var(--color-warning)]"
          : "text-muted-foreground";

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{item.tag || "—"}</span>
          <StatusBadge status={item.status} />
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">{item.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className={cn("font-medium", dueClass)}>{dueText}</span>
          {next ? (
            <span className="text-muted-foreground">{formatDate(next)}</span>
          ) : null}
          {item.location ? (
            <span className="truncate text-muted-foreground">· {item.location}</span>
          ) : null}
        </div>
      </div>
      {!allowSelect ? (
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "flex items-stretch gap-2 rounded-xl border border-border bg-card p-3 shadow-xs",
        selected && "border-primary/40 bg-primary/5 ring-2 ring-primary/30",
      )}
    >
      {allowSelect ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.()}
          className="tg-focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
          aria-pressed={selected}
          aria-label={`${selected ? "Deselect" : "Select"} ${item.tag || item.name} for printing`}
        >
          <Checkbox
            checked={selected}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none h-5 w-5 shrink-0"
          />
          {body}
        </button>
      ) : (
        <Link
          to="/workspace/$slug/equipment/$id"
          params={{ slug, id: item.id }}
          className="tg-focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
        >
          {body}
        </Link>
      )}
    </div>
  );
}
