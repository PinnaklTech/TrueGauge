import type { CalStatus } from "@/lib/mock-data";
import { statusLabel } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const styles: Record<CalStatus, string> = {
  calibrated: "bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] text-[color:var(--color-success)] ring-[color-mix(in_oklab,var(--color-success)_30%,transparent)]",
  "due-soon": "bg-[color-mix(in_oklab,var(--color-warning)_16%,transparent)] text-[color:var(--color-warning)] ring-[color-mix(in_oklab,var(--color-warning)_35%,transparent)]",
  overdue: "bg-[color-mix(in_oklab,var(--color-destructive)_14%,transparent)] text-[color:var(--color-destructive)] ring-[color-mix(in_oklab,var(--color-destructive)_30%,transparent)]",
  failed: "bg-[color-mix(in_oklab,var(--color-destructive)_20%,transparent)] text-[color:var(--color-destructive)] ring-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)]",
  inactive: "bg-muted text-muted-foreground ring-border",
};

export function StatusBadge({ status, className }: { status: CalStatus; className?: string }) {
  const urgent = status === "overdue" || status === "failed" || status === "due-soon";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
        styles[status],
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          urgent && "tg-pulse-dot",
          status === "calibrated" && "bg-[color:var(--color-success)]",
          status === "due-soon" && "bg-[color:var(--color-warning)]",
          (status === "overdue" || status === "failed") && "bg-[color:var(--color-destructive)]",
          status === "inactive" && "bg-muted-foreground",
        )}
      />
      {statusLabel[status]}
    </span>
  );
}
