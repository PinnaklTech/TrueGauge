import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";

const toneText: Record<string, string> = {
  default: "text-muted-foreground",
  success: "text-[color:var(--color-success)]",
  warning: "text-[color:var(--color-warning)]",
  danger: "text-[color:var(--color-destructive)]",
  info: "text-[color:var(--color-info)]",
};

type MetricTone = "default" | "success" | "warning" | "danger" | "info";

export function MetricCard({
  label,
  value,
  delta,
  hint,
  icon,
  tone = "default",
  deltaTone,
  to,
  search,
  params,
  stagger = 0,
  iconAttention = false,
  tourId,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  deltaTone?: MetricTone;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  stagger?: number;
  /** Soft motion on the icon to draw attention (e.g. overdue card). */
  iconAttention?: boolean;
  tourId?: string;
}) {
  const toneRing: Record<string, string> = {
    default: "text-muted-foreground bg-muted",
    success: "text-[color:var(--color-success)] bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)]",
    warning: "text-[color:var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)]",
    danger: "text-[color:var(--color-destructive)] bg-[color-mix(in_oklab,var(--color-destructive)_14%,transparent)]",
    info: "text-[color:var(--color-info)] bg-[color-mix(in_oklab,var(--color-info)_14%,transparent)]",
  };

  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="metric-value mt-2 text-3xl font-semibold tracking-tight text-foreground transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0">
          {value}
        </div>
        {delta && (
          <div className={cn("mt-1.5 text-xs font-semibold", toneText[deltaTone ?? tone])}>
            {delta}
          </div>
        )}
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      {icon && (
        <div
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            toneRing[tone],
            iconAttention
              ? "tg-attention-icon"
              : "transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-hover:rotate-0",
          )}
        >
          {icon}
        </div>
      )}
    </div>
  );

  const className = cn(
    "tg-stagger tg-panel group relative block overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xs",
    to && "tg-focus-ring tg-panel-hover cursor-pointer",
  );

  const style = { "--stagger": stagger } as CSSProperties;

  if (to) {
    return (
      <Link
        to={to}
        params={params}
        search={search}
        className={className}
        style={style}
        aria-label={`Open ${label}`}
        data-tour={tourId}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={className} style={style} data-tour={tourId}>
      {body}
    </div>
  );
}
