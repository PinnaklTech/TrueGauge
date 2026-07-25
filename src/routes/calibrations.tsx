import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { StatusBadge } from "@/components/tg/status-badge";
import { PageState } from "@/components/tg/page-state";
import {
  createCalibration,
  listCalibrations,
  listEquipment,
  type AppCalibration,
  type CalResult,
  type ProviderType,
} from "@/lib/api";
import { parseDate, urgencyBuckets } from "@/lib/compliance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type CalTab = "schedules" | "history" | "log";

export const Route = createFileRoute("/calibrations")({
  head: () => ({ meta: [{ title: "Calibrations · TrueGage" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: CalTab; equipment?: string } => {
    const tab = search.tab;
    const equipment = typeof search.equipment === "string" ? search.equipment : undefined;
    if (tab === "schedules" || tab === "history" || tab === "log") {
      return { tab, equipment };
    }
    return { equipment };
  },
  component: CalibrationsPage,
});

function CalibrationsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const tab: CalTab = search.tab ?? "schedules";

  const setTab = (next: CalTab, equipmentId?: string) => {
    void navigate({
      search: {
        tab: next === "schedules" ? undefined : next,
        equipment: next === "log" ? equipmentId || search.equipment : undefined,
      },
      replace: true,
    });
  };

  const { data } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
  });
  const { data: calData, isLoading: calLoading } = useQuery({
    queryKey: ["calibrations"],
    queryFn: () => listCalibrations(),
  });
  const equipment = data?.items ?? [];
  const calibrations = calData?.items ?? [];
  const { overdue, critical, normal } = urgencyBuckets(equipment);
  const pending = overdue.length + critical.length + normal.length;

  return (
    <AppShell breadcrumbs={[{ label: "Calibration Schedules" }]} hidePageHeader>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Calibration Scheduling & History
            </h1>
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
              Pending Cycles: {pending}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Log technical compliance runs, track calibration frequencies, and keep a verification
            timeline per gauge.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          {(
            [
              { id: "schedules", label: "Schedules & Urgency" },
              { id: "history", label: `History Log (${calibrations.length})` },
              { id: "log", label: "+ Log Calibration" },
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
      </div>

      {tab === "schedules" && (
        <div className="space-y-6">
          <section className="overflow-hidden rounded-xl border border-destructive/40 bg-card shadow-xs">
            <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive">
                Overdue Calibration Cycle ({overdue.length})
              </h2>
            </div>
            {overdue.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing overdue.</p>
            ) : (
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {overdue.map((e) => (
                  <UrgencyCard key={e.id} equipment={e} tone="danger" onLog={() => setTab("log", e.id)} />
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-warning/40 bg-card shadow-xs">
            <div className="border-b border-warning/30 bg-warning/10 px-5 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-warning">
                Critical Attention — Due in 1–3 Days ({critical.length})
              </h2>
            </div>
            {critical.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No calibrations due in the next 3 days.
              </p>
            ) : (
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {critical.map((e) => (
                  <UrgencyCard key={e.id} equipment={e} tone="warning" onLog={() => setTab("log", e.id)} />
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="border-b border-border bg-muted/40 px-5 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Normal Schedulers — Due Within 30 Days ({normal.length})
              </h2>
            </div>
            <div className="max-h-[50vh] overflow-x-auto tg-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5">Tag ID</th>
                    <th className="px-4 py-2.5">Gauge Name</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Department</th>
                    <th className="px-4 py-2.5">Next Due</th>
                    <th className="px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {normal.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No schedules in the next 30 days.
                      </td>
                    </tr>
                  ) : (
                    normal.map((e) => {
                      const next = parseDate(e.nextCalibration);
                      return (
                        <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-3 font-mono text-xs">{e.tag}</td>
                          <td className="px-4 py-3 font-medium">{e.name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.category || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.department || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {next ? format(next, "yyyy-MM-dd") : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline"
                              onClick={() => setTab("log", e.id)}
                            >
                              Log record
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "history" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="max-h-[70vh] overflow-x-auto tg-scrollbar">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Equipment</th>
                  <th className="px-4 py-2.5">Provider</th>
                  <th className="px-4 py-2.5">Certificate</th>
                  <th className="px-4 py-2.5">Result</th>
                </tr>
              </thead>
              <tbody>
                {calLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Loading history…
                    </td>
                  </tr>
                ) : calibrations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4">
                      <PageState
                        variant="empty"
                        title="No calibration history"
                        description="Logged verification runs will appear here and on each equipment timeline."
                        action={{ label: "Log calibration", onClick: () => setTab("log") }}
                        className="border-0 bg-transparent py-8"
                      />
                    </td>
                  </tr>
                ) : (
                  calibrations.map((c) => (
                    <HistoryRow key={c.id} record={c} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "log" && (
        <LogCalibrationForm
          equipmentOptions={equipment.map((e) => ({ id: e.id, label: `${e.tag} — ${e.name}` }))}
          initialEquipmentId={search.equipment}
          onCancel={() => setTab("schedules")}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ["calibrations"] });
            await queryClient.invalidateQueries({ queryKey: ["equipment"] });
            setTab("history");
          }}
        />
      )}
    </AppShell>
  );
}

function HistoryRow({ record: c }: { record: AppCalibration }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-4 py-3">{format(new Date(c.date), "MMM d, yyyy")}</td>
      <td className="px-4 py-3">
        <Link
          to="/equipment/$id"
          params={{ id: c.equipmentId }}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {c.equipmentName}
        </Link>
        <div className="font-mono text-[11px] text-muted-foreground">{c.equipmentTag}</div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {c.provider || "—"} <span className="text-[10px]">({c.type})</span>
      </td>
      <td className="px-4 py-3 font-mono text-xs">{c.certificateNo || "—"}</td>
      <td className="px-4 py-3 uppercase">{c.result}</td>
    </tr>
  );
}

function UrgencyCard({
  equipment: e,
  tone,
  onLog,
}: {
  equipment: {
    id: string;
    tag: string;
    name: string;
    department: string;
    owner: string;
    nextCalibration: string;
    days: number;
    status: "calibrated" | "due-soon" | "overdue" | "failed" | "inactive";
  };
  tone: "danger" | "warning";
  onLog: () => void;
}) {
  const next = parseDate(e.nextCalibration);
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">{e.name}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{e.tag}</div>
        </div>
        <StatusBadge status={e.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          Dept: <span className="text-foreground">{e.department || "—"}</span>
        </div>
        <div>
          Assigned: <span className="text-foreground">{e.owner || "—"}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span
          className={cn(
            "text-xs font-semibold uppercase",
            tone === "danger" ? "text-destructive" : "text-warning",
          )}
        >
          {tone === "danger" ? "Overdue" : "Due Soon"} · {next ? format(next, "yyyy-MM-dd") : "—"}
        </span>
        <button type="button" onClick={onLog} className="text-xs font-medium text-primary hover:underline">
          Log Cal Now →
        </button>
      </div>
    </div>
  );
}

function LogCalibrationForm({
  equipmentOptions,
  initialEquipmentId,
  onCancel,
  onSaved,
}: {
  equipmentOptions: { id: string; label: string }[];
  initialEquipmentId?: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [equipmentId, setEquipmentId] = useState(initialEquipmentId ?? "");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [providerType, setProviderType] = useState<ProviderType>("internal");
  const [provider, setProvider] = useState("");
  const [technician, setTechnician] = useState("");
  const [result, setResult] = useState<CalResult>("pass");
  const [notes, setNotes] = useState("");
  const [certificateNo, setCertificateNo] = useState("");

  useEffect(() => {
    if (initialEquipmentId) setEquipmentId(initialEquipmentId);
  }, [initialEquipmentId]);

  const mutation = useMutation({
    mutationFn: () =>
      createCalibration({
        equipment_id: equipmentId,
        date,
        type: providerType,
        provider,
        technician,
        result,
        notes: notes || undefined,
        certificate_no: certificateNo,
      }),
    onSuccess: async () => {
      toast.success("Calibration record saved");
      await onSaved();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to save calibration");
    },
  });

  const canSave = Boolean(equipmentId && date) && !mutation.isPending;

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xs">
      <h2 className="font-display text-lg font-semibold text-foreground">Log Calibration</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Record a verification run against a registered gauge. Saving updates the equipment timeline
        and next due date.
      </p>
      <form
        className="mt-5 grid gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!equipmentId) {
            toast.error("Select equipment");
            return;
          }
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cal-log-equipment">Target Gauge / Equipment Unit</Label>
          <select
            id="cal-log-equipment"
            className="tg-select"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            required
          >
            <option value="">Select equipment…</option>
            {equipmentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cal-log-date">Date of Verification</Label>
            <Input
              id="cal-log-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-log-provider-type">Provider Type</Label>
            <select
              id="cal-log-provider-type"
              className="tg-select"
              value={providerType}
              onChange={(e) => setProviderType(e.target.value as ProviderType)}
            >
              <option value="internal">internal</option>
              <option value="external">external</option>
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cal-log-provider">Provider Name</Label>
            <Input
              id="cal-log-provider"
              placeholder="Lab or internal team"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-log-technician">Technician</Label>
            <Input
              id="cal-log-technician"
              placeholder="Name"
              value={technician}
              onChange={(e) => setTechnician(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-log-result">Result</Label>
          <select
            id="cal-log-result"
            className="tg-select"
            value={result}
            onChange={(e) => setResult(e.target.value as CalResult)}
          >
            <option value="pass">pass</option>
            <option value="fail">fail</option>
            <option value="conditional">conditional</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-log-notes">Notes</Label>
          <Input
            id="cal-log-notes"
            placeholder="Findings / remarks"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-log-cert">Certificate File Reference</Label>
          <Input
            id="cal-log-cert"
            placeholder="CERT-…"
            value={certificateNo}
            onChange={(e) => setCertificateNo(e.target.value)}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onCancel} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {mutation.isPending ? "Saving…" : "Save record"}
          </Button>
        </div>
      </form>
    </div>
  );
}
