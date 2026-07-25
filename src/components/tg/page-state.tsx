import type { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageState({
  variant,
  title,
  description,
  action,
  className,
}: {
  variant: "loading" | "error" | "empty";
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  const Icon =
    variant === "loading" ? Loader2 : variant === "error" ? AlertCircle : Inbox;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center",
        variant === "error" && "border-destructive/30 bg-destructive/5",
        className,
      )}
      role={variant === "error" ? "alert" : "status"}
    >
      <Icon
        className={cn(
          "h-8 w-8 text-muted-foreground",
          variant === "loading" && "animate-spin text-primary",
          variant === "error" && "text-destructive",
        )}
      />
      <p
        className={cn(
          "mt-3 text-sm font-medium",
          variant === "error" ? "text-destructive" : "text-foreground",
        )}
      >
        {title}
      </p>
      {description && <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>}
      {action && (
        <Button size="sm" variant={variant === "error" ? "outline" : "default"} className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive",
        className,
      )}
      role="alert"
    >
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card shadow-xs", className)}>{children}</div>
  );
}
