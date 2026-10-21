import { useRef, useState } from "react";
import {
  downloadEquipmentTemplate,
  exportEquipmentCsv,
  importEquipmentFile,
  type EquipmentImportResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
};

export function EquipmentImportExportDialog({ open, onOpenChange, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"template" | "export" | "import" | null>(null);
  const [result, setResult] = useState<EquipmentImportResult | null>(null);

  const run = async (kind: "template" | "export" | "import", fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setResult(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-lg sm:rounded-lg",
          "top-0 left-0 h-auto max-h-[100dvh] max-w-none translate-x-0 translate-y-0 rounded-none",
          "sm:top-[50%] sm:left-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-4 text-left sm:px-6">
          <DialogTitle>Import / Export equipment</DialogTitle>
          <DialogDescription>
            Download a CSV template, export your register, or upload a CSV/Excel file to add many
            gauges at once. Existing tags are skipped (create-only).
          </DialogDescription>
        </DialogHeader>

        <div className="tg-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 justify-start sm:h-10"
              disabled={busy !== null}
              onClick={() => {
                void (async () => {
                  try {
                    await run("template", async () => {
                      await downloadEquipmentTemplate();
                      toast.success("Template downloaded");
                    });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Download failed");
                  }
                })();
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              {busy === "template" ? "Downloading…" : "Download template"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 justify-start sm:h-10"
              disabled={busy !== null}
              onClick={() => {
                void (async () => {
                  try {
                    await run("export", async () => {
                      await exportEquipmentCsv();
                      toast.success("Export downloaded");
                    });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Export failed");
                  }
                })();
              }}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {busy === "export" ? "Exporting…" : "Export all"}
            </Button>
          </div>

          <div className="rounded-xl border border-dashed border-border bg-surface/40 p-4">
            <p className="text-sm font-medium text-foreground">Upload CSV or Excel</p>
            <p className="mt-1 text-xs text-muted-foreground">
              .csv or .xlsx · max 2,000 rows · required column: name · tag recommended
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setResult(null);
                void (async () => {
                  try {
                    await run("import", async () => {
                      const res = await importEquipmentFile(file);
                      setResult(res);
                      if (res.created > 0) {
                        toast.success(`Imported ${res.created} equipment`);
                        onImported?.();
                      } else if (res.skipped > 0 && res.failed === 0) {
                        toast.message("Nothing new imported", {
                          description: `${res.skipped} row(s) skipped (duplicate tags)`,
                        });
                      } else {
                        toast.error("Import finished with errors — see details below");
                      }
                    });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Import failed");
                  }
                })();
              }}
            />
            <Button
              type="button"
              className="mt-3 h-11 w-full sm:h-10"
              disabled={busy !== null}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {busy === "import" ? "Uploading…" : "Choose file to import"}
            </Button>
          </div>

          {result ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <p className="text-sm font-semibold text-foreground">Import results</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-success/15 px-2.5 py-1 font-semibold text-success">
                  Created {result.created}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">
                  Skipped {result.skipped}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 font-semibold",
                    result.failed > 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  Failed {result.failed}
                </span>
              </div>
              {result.errors.length > 0 ? (
                <ul className="tg-scrollbar max-h-48 space-y-1.5 overflow-y-auto text-xs">
                  {result.errors.map((e, i) => (
                    <li
                      key={`${e.row}-${e.field}-${i}`}
                      className="rounded-md border border-border bg-surface/50 px-2.5 py-1.5 text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">Row {e.row}</span>
                      {e.field ? ` · ${e.field}` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No row errors.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto sm:ml-auto sm:flex"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
