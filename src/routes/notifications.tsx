import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { ErrorBanner, PageState } from "@/components/tg/page-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listEmailHistory,
  listEquipment,
  listNotifications,
  listTeamMembers,
  markAllNotificationsRead,
  markNotificationRead,
  sendOverdueAlert,
  getMe,
  type AppNotificationApi,
  type EmailAuditItem,
  type TeamMember,
} from "@/lib/api";
import { urgencyBuckets } from "@/lib/compliance";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { format, isValid, parseISO } from "date-fns";
import { Mail, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications · True Gauge" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"inbox" | "emails">("inbox");
  const [sendOpen, setSendOpen] = useState(false);

  const { data: eqData } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
  });
  const equipment = eqData?.items ?? [];
  const { overdue } = useMemo(() => urgencyBuckets(equipment), [equipment]);

  const {
    data: notifData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
  });

  const {
    data: emailData,
    isLoading: emailLoading,
    isError: emailError,
    error: emailErr,
    refetch: refetchEmails,
  } = useQuery({
    queryKey: ["email-history"],
    queryFn: () => listEmailHistory(100),
    enabled: tab === "emails",
  });

  const items = notifData?.items ?? [];
  const unread = notifData?.unread ?? 0;
  const emails = emailData?.items ?? [];

  const markAllRead = async () => {
    try {
      await markAllNotificationsRead();
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("All notifications marked read");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  };

  const onOpenItem = async (n: AppNotificationApi) => {
    if (n.read) return;
    try {
      await markNotificationRead(n.id);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      /* ignore */
    }
  };

  const toneDot = (n: AppNotificationApi) => {
    if (n.type === "activity") return "bg-info";
    if (n.title.toLowerCase().includes("overdue")) return "bg-destructive";
    if (n.title.toLowerCase().includes("due")) return "bg-warning";
    return "bg-info";
  };

  return (
    <AppShell breadcrumbs={[{ label: "Notification Center" }]} hidePageHeader>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            System Notification Center
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Due-date alerts and outbound email history are stored in the database.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {overdue.length > 0 && (
            <Button size="sm" onClick={() => setSendOpen(true)}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Email overdue list ({overdue.length})
            </Button>
          )}
          {tab === "inbox" && items.length > 0 && unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-sm font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1 w-fit">
        {(
          [
            { id: "inbox", label: `Inbox${unread ? ` (${unread})` : ""}` },
            { id: "emails", label: "Past emails" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "inbox" && (
        <>
          {isError && (
            <ErrorBanner
              message={error instanceof Error ? error.message : "Could not load notifications."}
              onRetry={() => void refetch()}
            />
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {isLoading ? (
              <PageState
                variant="loading"
                title="Loading inbox…"
                className="m-4 border-0 bg-transparent"
              />
            ) : items.length === 0 ? (
              <PageState
                variant="empty"
                title="No notifications yet"
                description={
                  equipment.length === 0
                    ? "Add or import equipment first. Overdue and due-within-3-days assets will appear here."
                    : "None of your equipment is overdue or due within 3 days right now."
                }
                action={{
                  label: "Open equipment",
                  onClick: () => void navigate({ to: "/equipment" }),
                }}
                className="m-4 border-0 bg-transparent"
              />
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const when = (() => {
                    if (!n.when) return null;
                    const d = parseISO(n.when);
                    return isValid(d) ? format(d, "yyyy-MM-dd") : n.when;
                  })();
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "flex cursor-pointer gap-3 px-5 py-4",
                        !n.read && "bg-primary/[0.03]",
                      )}
                      onClick={() => void onOpenItem(n)}
                    >
                      <span
                        className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", toneDot(n))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{n.title}</h3>
                          {!n.read && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                              New
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                        {when && (
                          <div className="mt-2 text-[11px] text-muted-foreground">Date: {when}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {tab === "emails" && (
        <>
          {emailError && (
            <ErrorBanner
              message={emailErr instanceof Error ? emailErr.message : "Could not load email history."}
              onRetry={() => void refetchEmails()}
            />
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {emailLoading ? (
              <PageState
                variant="loading"
                title="Loading email history…"
                className="m-4 border-0 bg-transparent"
              />
            ) : emails.length === 0 ? (
              <PageState
                variant="empty"
                title="No emails sent yet"
                description="SMTP check emails and overdue alerts will appear here after you send them."
                className="m-4 border-0 bg-transparent"
              />
            ) : (
              <div className="max-h-[70vh] overflow-auto tg-scrollbar">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2.5">When</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">To</th>
                      <th className="px-4 py-2.5">Subject</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emails.map((row) => (
                      <EmailRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <SendOverdueEmailDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        overdueCount={overdue.length}
        onSent={() => {
          void queryClient.invalidateQueries({ queryKey: ["email-history"] });
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }}
      />
    </AppShell>
  );
}

function EmailRow({ row }: { row: EmailAuditItem }) {
  const when = (() => {
    const d = parseISO(row.created_at);
    return isValid(d) ? format(d, "MMM d, yyyy HH:mm") : row.created_at;
  })();
  const kindLabel =
    row.kind === "overdue_alert"
      ? "Overdue alert"
      : row.kind === "test_check"
        ? "Check email"
        : row.kind;
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{when}</td>
      <td className="px-4 py-3">{kindLabel}</td>
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">{row.to_name || "—"}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{row.to_email}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-foreground">{row.subject || "—"}</div>
        {row.detail && <div className="text-xs text-muted-foreground">{row.detail}</div>}
        {row.error && <div className="text-xs text-destructive">{row.error}</div>}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase",
            row.status === "sent"
              ? "bg-success/15 text-success"
              : "bg-destructive/15 text-destructive",
          )}
        >
          {row.status}
        </span>
        {row.equipment_count > 0 && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            {row.equipment_count} gauge{row.equipment_count === 1 ? "" : "s"}
          </div>
        )}
      </td>
    </tr>
  );
}

function SendOverdueEmailDialog({
  open,
  onOpenChange,
  overdueCount,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overdueCount: number;
  onSent?: () => void;
}) {
  const navigate = useNavigate();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void Promise.all([listTeamMembers(), getMe().catch(() => null)])
      .then(([data, me]) => {
        const admin = me?.role === "admin" || me?.role === "platform_admin";
        setIsAdmin(admin);
        const list = admin
          ? data.items
          : data.items.filter((m) => m.org_member !== false);
        setMembers(list);
        setSelected(new Set(list.filter((m) => m.active).map((m) => m.id)));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load team"))
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onSend = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one recipient");
      return;
    }
    setSending(true);
    try {
      const result = await sendOverdueAlert([...selected]);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email overdue list
          </DialogTitle>
          <DialogDescription>
            Send {overdueCount} overdue equipment item{overdueCount === 1 ? "" : "s"} to selected
            recipients.
            {!isAdmin && " You can only choose organization members."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading team…</p>
        ) : members.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {isAdmin ? (
              <>
                No team members yet.{" "}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    onOpenChange(false);
                    void navigate({ to: "/settings" });
                  }}
                >
                  Add recipients in Settings
                </button>
              </>
            ) : (
              "No organization members are available to email. Ask an admin to mark recipients as org members."
            )}
          </div>
        ) : (
          <ul className="max-h-60 space-y-2 overflow-auto">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <Checkbox
                  checked={selected.has(m.id)}
                  onCheckedChange={(c) => toggle(m.id, c === true)}
                  id={`overdue-recip-${m.id}`}
                />
                <label htmlFor={`overdue-recip-${m.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{m.name || m.email}</span>
                    {isAdmin && m.org_member === false && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        True Gauge / external
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{m.email}</div>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onSend()} disabled={sending || members.length === 0}>
            {sending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
