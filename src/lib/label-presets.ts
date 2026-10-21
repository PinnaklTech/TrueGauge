/**
 * Physical label sheet presets (mm). Sheet cell sizes for Avery-style products
 * are taken from manufacturer datasheets — do not invent dimensions.
 *
 * Sources:
 * - Avery L7651 (65-up): 38.1 × 21.2 mm, A4, 5×13 — Avery EU datasheet
 * - Avery L7173-style 3×10: 70 × 29.7 mm cells on A4 (common EU laser sheet)
 * - Thermal sizes: shop-floor gauge stickers (exact page = label)
 */

export type PageSizeName = "A4" | "Letter";
export type SheetMode = "precut" | "print_cut" | "thermal";
export type CutGuideStyle = "none" | "dashed" | "crop_marks";
export type EccLevel = "M" | "Q";

export interface SheetGeometry {
  pageSize: PageSizeName;
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  columns: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  gutterXMm: number;
  gutterYMm: number;
  cornerRadiusMm: number;
  innerPaddingMm: number;
}

export interface LabelPreset {
  id: string;
  label: string;
  notes: string;
  mode: SheetMode;
  geometry: SheetGeometry;
  /** Default content flags for this preset */
  defaults: {
    showName: boolean;
    showSerial: boolean;
    showOrg: boolean;
    showTagUnderQr: boolean;
    cutGuides: CutGuideStyle;
  };
  sourceNote?: string;
}

export const PAGE_SIZES: Record<PageSizeName, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
};

/** Minimum QR module size on the printed label (mm). */
export const MIN_MODULE_MM = 0.4;
/** Quiet zone in modules on each side. */
export const QUIET_ZONE_MODULES = 4;
/** Approx Version-3 QR modules (29×29) + quiet zone → ~37 modules across. */
export const QR_VERSION3_MODULES = 29;
export const MIN_QR_SYMBOL_MM =
  (QR_VERSION3_MODULES + QUIET_ZONE_MODULES * 2) * MIN_MODULE_MM; // ~14.8 → enforce 12mm floor per spec

export const LABEL_PRESETS: LabelPreset[] = [
  {
    id: "plain-a4-grid",
    label: "A4 print & cut (50×25 mm) — default",
    notes: "A4 page · dashed cut guides · 3×10 grid · scissors/trimmer ready",
    mode: "print_cut",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginTopMm: 10,
      marginLeftMm: 10,
      columns: 3,
      rows: 10,
      cellWidthMm: 50,
      cellHeightMm: 25,
      gutterXMm: 5,
      gutterYMm: 3,
      cornerRadiusMm: 0,
      innerPaddingMm: 1.5,
    },
    defaults: {
      showName: true,
      showSerial: false,
      showOrg: false,
      showTagUnderQr: true,
      cutGuides: "dashed",
    },
  },
  {
    id: "a4-3x10",
    label: "A4 sheet 3×10 (70×29.7 mm)",
    notes: "A4 · 30 labels/sheet · dashed cut guides",
    mode: "print_cut",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginTopMm: 9.5,
      marginLeftMm: 0,
      columns: 3,
      rows: 10,
      cellWidthMm: 70,
      cellHeightMm: 29.7,
      gutterXMm: 0,
      gutterYMm: 0,
      cornerRadiusMm: 1.5,
      innerPaddingMm: 1.5,
    },
    defaults: {
      showName: true,
      showSerial: false,
      showOrg: false,
      showTagUnderQr: true,
      cutGuides: "dashed",
    },
    sourceNote: "Avery L7173-class 70×29.7 mm on A4 (EU datasheet cell size)",
  },
  {
    id: "a4-65up",
    label: "A4 sheet 65-up (38.1×21.2 mm)",
    notes: "A4 · Avery L7651 · 5×13 · dashed cut guides",
    mode: "print_cut",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginTopMm: 10.7,
      marginLeftMm: 4.7,
      columns: 5,
      rows: 13,
      cellWidthMm: 38.1,
      cellHeightMm: 21.2,
      gutterXMm: 2.5,
      gutterYMm: 0,
      cornerRadiusMm: 1,
      innerPaddingMm: 1,
    },
    defaults: {
      showName: false,
      showSerial: false,
      showOrg: false,
      showTagUnderQr: true,
      cutGuides: "dashed",
    },
    sourceNote: "Avery L7651 - 38.1x21.2 mm, A4, 5 cols x 13 rows (Avery EU)",
  },
  {
    id: "a4-crop-marks",
    label: "A4 print & cut (crop marks)",
    notes: "A4 · 50×25 mm · corner crop marks in gutters",
    mode: "print_cut",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginTopMm: 10,
      marginLeftMm: 10,
      columns: 3,
      rows: 10,
      cellWidthMm: 50,
      cellHeightMm: 25,
      gutterXMm: 5,
      gutterYMm: 3,
      cornerRadiusMm: 0,
      innerPaddingMm: 1.5,
    },
    defaults: {
      showName: true,
      showSerial: false,
      showOrg: false,
      showTagUnderQr: true,
      cutGuides: "crop_marks",
    },
  },
  {
    id: "thermal-standard",
    label: "Thermal Standard (50×25 mm)",
    notes: "One label per page · thermal printers",
    mode: "thermal",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 50,
      pageHeightMm: 25,
      marginTopMm: 0,
      marginLeftMm: 0,
      columns: 1,
      rows: 1,
      cellWidthMm: 50,
      cellHeightMm: 25,
      gutterXMm: 0,
      gutterYMm: 0,
      cornerRadiusMm: 0,
      innerPaddingMm: 1.2,
    },
    defaults: {
      showName: true,
      showSerial: false,
      showOrg: false,
      showTagUnderQr: true,
      cutGuides: "none",
    },
  },
  {
    id: "thermal-large",
    label: "Thermal Large (100×50 mm)",
    notes: "One label per page · QR + tag + name + serial + org",
    mode: "thermal",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 100,
      pageHeightMm: 50,
      marginTopMm: 0,
      marginLeftMm: 0,
      columns: 1,
      rows: 1,
      cellWidthMm: 100,
      cellHeightMm: 50,
      gutterXMm: 0,
      gutterYMm: 0,
      cornerRadiusMm: 0,
      innerPaddingMm: 2,
    },
    defaults: {
      showName: true,
      showSerial: true,
      showOrg: true,
      showTagUnderQr: true,
      cutGuides: "none",
    },
  },
  {
    id: "thermal-small",
    label: "Thermal Small (25×15 mm)",
    notes: "QR + tag only · one label per page",
    mode: "thermal",
    geometry: {
      pageSize: "A4",
      pageWidthMm: 25,
      pageHeightMm: 15,
      marginTopMm: 0,
      marginLeftMm: 0,
      columns: 1,
      rows: 1,
      cellWidthMm: 25,
      cellHeightMm: 15,
      gutterXMm: 0,
      gutterYMm: 0,
      cornerRadiusMm: 0,
      innerPaddingMm: 0.8,
    },
    defaults: {
      showName: false,
      showSerial: false,
      showOrg: false,
      showTagUnderQr: true,
      cutGuides: "none",
    },
  },
];

/** Default: A4 sheet with dashed cut guides for print-and-cut. */
export const DEFAULT_PRESET_ID = "plain-a4-grid";

export function getPreset(id: string): LabelPreset {
  return LABEL_PRESETS.find((p) => p.id === id) ?? LABEL_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
}

export function labelsPerSheet(g: SheetGeometry): number {
  return g.columns * g.rows;
}

export function estimatePages(count: number, g: SheetGeometry, startIndex = 0): number {
  const capacity = labelsPerSheet(g);
  if (capacity <= 0) return 0;
  return Math.ceil((startIndex + count) / capacity);
}

const OFFSET_STORAGE_KEY = "tg-label-print-offset";

export function loadPrintOffset(presetId: string): { xMm: number; yMm: number } {
  try {
    const raw = localStorage.getItem(OFFSET_STORAGE_KEY);
    if (!raw) return { xMm: 0, yMm: 0 };
    const all = JSON.parse(raw) as Record<string, { xMm?: number; yMm?: number }>;
    const entry = all[presetId];
    return { xMm: entry?.xMm ?? 0, yMm: entry?.yMm ?? 0 };
  } catch {
    return { xMm: 0, yMm: 0 };
  }
}

export function savePrintOffset(presetId: string, offset: { xMm: number; yMm: number }) {
  try {
    const raw = localStorage.getItem(OFFSET_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, { xMm: number; yMm: number }>) : {};
    all[presetId] = offset;
    localStorage.setItem(OFFSET_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
