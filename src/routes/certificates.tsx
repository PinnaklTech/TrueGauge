import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/tg/app-shell";
import { listEquipment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, UploadCloud, Search, Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/certificates")({
  head: () => ({ meta: [{ title: "Certificates · TrueGage" }] }),
  component: CertificatesPage,
});

function CertificatesPage() {
  const [q, setQ] = useState("");
  const [gaugeId, setGaugeId] = useState("");
  const { data } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
  });
  const equipment = data?.items ?? [];

  return (
    <AppShell breadcrumbs={[{ label: "Compliance Documents" }]} hidePageHeader>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          ISO Compliance Certificates & Document Vault
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Store and preview digital PDF calibration records once certificate storage is connected.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search certificate list…"
              className="h-10 pl-8"
              disabled
            />
          </div>

          <div className="rounded-xl border border-border bg-card px-6 py-14 text-center shadow-xs">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">No certificates available</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
              TrueGage does not have a certificates API yet, so this vault is empty. When document
              storage is added, uploaded PDFs linked to equipment will appear here.
              {q ? " Search is disabled until certificates exist." : ""}
            </p>
          </div>
        </div>

        <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Certificates Upload Center
          </h2>
          <div className="mt-3 flex gap-2 rounded-lg border border-dashed border-border bg-surface/50 px-3 py-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Upload is disabled until certificate storage is connected on the backend.
          </div>
          <div className="mt-4 space-y-1.5">
            <Label
              htmlFor="cert-gauge-id"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Select Target Gauge ID
            </Label>
            <select
              id="cert-gauge-id"
              value={gaugeId}
              onChange={(e) => setGaugeId(e.target.value)}
              className="tg-select"
              disabled
            >
              <option value="">— Associate to Gauge —</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.tag} — {e.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() =>
              toast.message("Certificate upload is not available yet — no document storage API.")
            }
            className="mt-4 flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface/50 px-4 py-10 text-center opacity-70"
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">Upload unavailable</p>
            <span className="mt-3 inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium">
              Coming later
            </span>
          </button>
        </aside>
      </div>
    </AppShell>
  );
}
