import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  auditLabelsPrinted,
  fetchEquipmentLabels,
  type EquipmentLabel,
} from "@/lib/api";
import {
  DEFAULT_PRESET_ID,
  LABEL_PRESETS,
  estimatePages,
  getPreset,
  labelsPerSheet,
  loadPrintOffset,
  savePrintOffset,
  type CutGuideStyle,
  type EccLevel,
} from "@/lib/label-presets";
import { buildLabelsPdf, downloadPdfBytes, openPdfForPrint } from "@/lib/label-pdf";
import { toast } from "sonner";
import { Download, Loader2, Printer, TestTube2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentIds: string[];
};

export function PrintLabelsDialog({ open, onOpenChange, equipmentIds }: Props) {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [showName, setShowName] = useState(true);
  const [showSerial, setShowSerial] = useState(false);
  const [showOrg, setShowOrg] = useState(false);
  const [showTagUnderQr, setShowTagUnderQr] = useState(true);
  const [ecc, setEcc] = useState<EccLevel>("M");
  const [border, setBorder] = useState(false);
  const [cutGuides, setCutGuides] = useState<CutGuideStyle>("dashed");
  const [offsetXMm, setOffsetXMm] = useState(0);
  const [offsetYMm, setOffsetYMm] = useState(0);
  const [startRow, setStartRow] = useState(1);
  const [startCol, setStartCol] = useState(1);
  const [sortBy, setSortBy] = useState<"tag" | "department" | "location" | "none">("tag");
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<EquipmentLabel[]>([]);
  const [loading, setLoading] = useState(false);

  const preset = getPreset(presetId);
  const g = preset.geometry;
  const startCell = (startRow - 1) * g.columns + (startCol - 1);
  const pages = estimatePages(equipmentIds.length, g, Math.max(0, startCell));

  useEffect(() => {
    if (!open) return;
    const p = getPreset(presetId);
    setShowName(p.defaults.showName);
    setShowSerial(p.defaults.showSerial);
    setShowOrg(p.defaults.showOrg);
    setShowTagUnderQr(p.defaults.showTagUnderQr);
    setCutGuides(p.defaults.cutGuides);
    const off = loadPrintOffset(presetId);
    setOffsetXMm(off.xMm);
    setOffsetYMm(off.yMm);
    setStartRow(1);
    setStartCol(1);
  }, [open, presetId]);

  useEffect(() => {
    if (!open || equipmentIds.length === 0) {
      setLabels([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchEquipmentLabels(equipmentIds)
      .then((items) => {
        if (!cancelled) setLabels(items);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load label data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, equipmentIds]);

  const previewLabel = labels[0];

  const options = useMemo(
    () => ({
      preset,
      showName,
      showSerial,
      showOrg,
      showTagUnderQr,
      ecc,
      border,
      cutGuides,
      offsetXMm,
      offsetYMm,
      startCell: Math.max(0, Math.min(startCell, labelsPerSheet(g) - 1)),
      sortBy,
    }),
    [
      preset,
      showName,
      showSerial,
      showOrg,
      showTagUnderQr,
      ecc,
      border,
      cutGuides,
      offsetXMm,
      offsetYMm,
      startCell,
      sortBy,
      g,
    ],
  );

  const runPdf = async (mode: "download" | "print" | "test") => {
    setBusy(true);
    savePrintOffset(presetId, { xMm: offsetXMm, yMm: offsetYMm });
    try {
      const result = await buildLabelsPdf(mode === "test" ? [] : labels, {
        ...options,
        testPrintOnly: mode === "test",
      });
      if (result.warnings.length) {
        toast.warning(result.warnings[0]);
      }
      if (mode === "print") openPdfForPrint(result.bytes);
      else downloadPdfBytes(result.bytes, result.filename);

      if (mode !== "test" && labels.length > 0) {
        try {
          await auditLabelsPrinted({
            ids: labels.map((l) => l.id),
            count: labels.length,
            preset: preset.label,
          });
        } catch {
          /* non-blocking */
        }
        toast.success(`Generated ${labels.length} label${labels.length === 1 ? "" : "s"}`);
      } else if (mode === "test") {
        toast.success("Test page downloaded — print at 100% / Actual size");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PDF generation failed";
      // Surface encoding / size issues clearly
      toast.error(msg.includes("WinAnsi") || msg.includes("encode")
        ? "Label text had unsupported characters — try again (special characters are now stripped)."
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Print labels</DialogTitle>
          <DialogDescription>
            {equipmentIds.length} selected · PDF at exact physical size (mm)
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            Print at <strong>100% / Actual size</strong>. Turn off “Fit to page” and “Shrink to
            fit”.
          </div>

          <div>
            <Label className="text-xs">Label preset</Label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABEL_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">{preset.notes}</p>
            {preset.sourceNote && (
              <p className="text-[10px] text-muted-foreground/80">{preset.sourceNote}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={showTagUnderQr} onCheckedChange={(v) => setShowTagUnderQr(v === true)} />
              Tag under QR
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={showName} onCheckedChange={(v) => setShowName(v === true)} />
              Show name
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={showSerial} onCheckedChange={(v) => setShowSerial(v === true)} />
              Show serial
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={showOrg} onCheckedChange={(v) => setShowOrg(v === true)} />
              Show org name
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={border} onCheckedChange={(v) => setBorder(v === true)} />
              Cell border
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Error correction</Label>
              <Select value={ecc} onValueChange={(v) => setEcc(v as EccLevel)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">M (standard)</SelectItem>
                  <SelectItem value="Q">Q (rugged)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cut guides</Label>
              <Select value={cutGuides} onValueChange={(v) => setCutGuides(v as CutGuideStyle)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="dashed">Dashed outline</SelectItem>
                  <SelectItem value="crop_marks">Corner crop marks</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Sort by</Label>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tag">Tag ID</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                  <SelectItem value="location">Location</SelectItem>
                  <SelectItem value="none">As selected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sheets</Label>
              <p className="mt-2 text-sm text-muted-foreground">
                {labelsPerSheet(g)} / sheet · ~{pages} page{pages === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {preset.mode !== "thermal" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start row</Label>
                <Input
                  type="number"
                  min={1}
                  max={g.rows}
                  className="mt-1"
                  value={startRow}
                  onChange={(e) => setStartRow(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div>
                <Label className="text-xs">Start column</Label>
                <Input
                  type="number"
                  min={1}
                  max={g.columns}
                  className="mt-1"
                  value={startCol}
                  onChange={(e) => setStartCol(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Offset X (mm)</Label>
              <Input
                type="number"
                step={0.1}
                className="mt-1"
                value={offsetXMm}
                onChange={(e) => setOffsetXMm(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-xs">Offset Y (mm)</Label>
              <Input
                type="number"
                step={0.1}
                className="mt-1"
                value={offsetYMm}
                onChange={(e) => setOffsetYMm(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-foreground">Preview (first label)</p>
            {loading ? (
              <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
            ) : previewLabel ? (
              <div className="mt-2 flex items-center gap-3">
                <div className="grid h-16 w-16 place-items-center rounded border border-border bg-white text-[10px] font-mono text-foreground">
                  QR
                </div>
                <div className="min-w-0 text-xs">
                  <p className="font-mono font-semibold">{previewLabel.tag}</p>
                  {showName && <p className="truncate text-muted-foreground">{previewLabel.name}</p>}
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    /q/{previewLabel.qr_token}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No label data</p>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void runPdf("test")}
            className="w-full sm:w-auto"
          >
            <TestTube2 className="mr-1.5 h-3.5 w-3.5" />
            Test print
          </Button>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              disabled={busy || loading || labels.length === 0}
              onClick={() => void runPdf("print")}
              className="flex-1 sm:flex-none"
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-1.5 h-3.5 w-3.5" />}
              Print
            </Button>
            <Button
              type="button"
              disabled={busy || loading || labels.length === 0}
              onClick={() => void runPdf("download")}
              className="flex-1 sm:flex-none"
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Download PDF
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
