import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import type { EquipmentLabel } from "@/lib/api";
import {
  type CutGuideStyle,
  type EccLevel,
  type LabelPreset,
  type SheetGeometry,
  MIN_MODULE_MM,
  QUIET_ZONE_MODULES,
  labelsPerSheet,
} from "@/lib/label-presets";

const MM_TO_PT = 72 / 25.4;

function mm(n: number): number {
  return n * MM_TO_PT;
}

export interface LabelRenderOptions {
  preset: LabelPreset;
  showName: boolean;
  showSerial: boolean;
  showOrg: boolean;
  showTagUnderQr: boolean;
  ecc: EccLevel;
  border: boolean;
  cutGuides: CutGuideStyle;
  offsetXMm: number;
  offsetYMm: number;
  /** 0-based cell index to start filling (skip used cells). */
  startCell: number;
  sortBy: "tag" | "department" | "location" | "none";
  /** When true, draw grid only (no QR/data) for alignment test. */
  testPrintOnly?: boolean;
  geometryOverride?: Partial<SheetGeometry>;
}

export interface LabelPdfResult {
  bytes: Uint8Array;
  filename: string;
  pageCount: number;
  warnings: string[];
}

function labelUrl(token: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/q/${token}`;
  }
  return `https://app.thetruegage.com/q/${token}`;
}

/**
 * Helvetica (WinAnsi) cannot encode tabs, newlines, emoji, or many Unicode glyphs.
 * Normalize equipment text so PDF generation never throws.
 */
function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text || "") {
    const code = ch.codePointAt(0) ?? 0;
    // Whitespace controls (tab, CR, LF, etc.) → space
    if (code <= 0x1f || code === 0x7f) {
      out += " ";
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    // Common Windows-1252 / typographic replacements
    switch (code) {
      case 0xa0: // nbsp
        out += " ";
        break;
      case 0x2018:
      case 0x2019:
      case 0x201a:
      case 0x2032:
        out += "'";
        break;
      case 0x201c:
      case 0x201d:
      case 0x201e:
      case 0x2033:
        out += '"';
        break;
      case 0x2013:
      case 0x2014:
      case 0x2212:
        out += "-";
        break;
      case 0x2026:
        out += "...";
        break;
      case 0x00b7:
      case 0x2022:
        out += "-";
        break;
      default:
        // Keep Latin-1 supplement when WinAnsi can represent it (0xA0-0xFF minus gaps)
        if (code >= 0xa0 && code <= 0xff) {
          out += ch;
        }
        // else drop unsupported glyph
        break;
    }
  }
  return out.replace(/ +/g, " ").trim();
}

function truncate(text: string, maxChars: number): string {
  const t = toWinAnsi(text);
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeDrawText(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    color: ReturnType<typeof rgb>;
    maxWidth?: number;
  },
) {
  const cleaned = toWinAnsi(text);
  if (!cleaned) return;
  try {
    page.drawText(cleaned, opts);
  } catch {
    // Last resort: ASCII-only strip
    const ascii = cleaned.replace(/[^\x20-\x7E]/g, "").trim();
    if (ascii) page.drawText(ascii, opts);
  }
}

function sortLabels(items: EquipmentLabel[], sortBy: LabelRenderOptions["sortBy"]): EquipmentLabel[] {
  if (sortBy === "none") return [...items];
  const key = sortBy === "tag" ? "tag" : sortBy === "department" ? "department" : "location";
  return [...items].sort((a, b) => (a[key] || "").localeCompare(b[key] || "", undefined, { sensitivity: "base" }));
}

function cellOrigin(g: SheetGeometry, cellIndex: number): { xMm: number; yMm: number } {
  const col = cellIndex % g.columns;
  const row = Math.floor(cellIndex / g.columns) % g.rows;
  const xMm = g.marginLeftMm + col * (g.cellWidthMm + g.gutterXMm);
  // PDF y is bottom-up; convert from top-left layout
  const topMm = g.marginTopMm + row * (g.cellHeightMm + g.gutterYMm);
  const yMm = g.pageHeightMm - topMm - g.cellHeightMm;
  return { xMm, yMm };
}

async function qrMatrix(data: string, ecc: EccLevel): Promise<boolean[][]> {
  const qr = QRCode.create(data, {
    errorCorrectionLevel: ecc,
  });
  const size = qr.modules.size;
  const matrix: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) {
      row.push(qr.modules.get(y, x) === 1);
    }
    matrix.push(row);
  }
  return matrix;
}

function drawVectorQr(
  page: PDFPage,
  matrix: boolean[][],
  originXPt: number,
  originYPt: number,
  modulePt: number,
) {
  const size = matrix.length;
  const quiet = QUIET_ZONE_MODULES;
  // White quiet zone + body
  const total = size + quiet * 2;
  page.drawRectangle({
    x: originXPt,
    y: originYPt,
    width: total * modulePt,
    height: total * modulePt,
    color: rgb(1, 1, 1),
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!matrix[y][x]) continue;
      page.drawRectangle({
        x: originXPt + (x + quiet) * modulePt,
        y: originYPt + (size - 1 - y + quiet) * modulePt,
        width: modulePt,
        height: modulePt,
        color: rgb(0, 0, 0),
      });
    }
  }
}

function drawCutGuides(
  page: PDFPage,
  g: SheetGeometry,
  style: CutGuideStyle,
  offsetXMm: number,
  offsetYMm: number,
) {
  if (style === "none") return;
  const perPage = labelsPerSheet(g);
  const gray = rgb(0.7, 0.7, 0.7);
  for (let i = 0; i < perPage; i++) {
    const { xMm, yMm } = cellOrigin(g, i);
    const x = mm(xMm + offsetXMm);
    const y = mm(yMm + offsetYMm);
    const w = mm(g.cellWidthMm);
    const h = mm(g.cellHeightMm);
    if (style === "dashed") {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: gray,
        borderWidth: mm(0.2),
      });
    } else if (style === "crop_marks") {
      const mark = mm(2);
      const gap = mm(0.8);
      // corners outside cell
      const marks: Array<[number, number, number, number]> = [
        [x - gap - mark, y + h, mark, 0],
        [x, y + h + gap, 0, mark],
        [x + w + gap, y + h, mark, 0],
        [x + w, y + h + gap, 0, mark],
        [x - gap - mark, y, mark, 0],
        [x, y - gap - mark, 0, mark],
        [x + w + gap, y, mark, 0],
        [x + w, y - gap - mark, 0, mark],
      ];
      for (const [mx, my, mw, mh] of marks) {
        page.drawRectangle({
          x: mw ? mx : mx - mm(0.1),
          y: mh ? my : my - mm(0.1),
          width: mw || mm(0.2),
          height: mh || mm(0.2),
          color: gray,
        });
      }
    }
  }
}

function drawLabelContent(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  item: EquipmentLabel,
  matrix: boolean[][],
  g: SheetGeometry,
  cellIndex: number,
  opts: LabelRenderOptions,
  warnings: string[],
) {
  const { xMm, yMm } = cellOrigin(g, cellIndex);
  const pad = g.innerPaddingMm;
  const x0 = mm(xMm + opts.offsetXMm + pad);
  const y0 = mm(yMm + opts.offsetYMm + pad);
  const innerW = mm(g.cellWidthMm - pad * 2);
  const innerH = mm(g.cellHeightMm - pad * 2);

  if (opts.border) {
    page.drawRectangle({
      x: mm(xMm + opts.offsetXMm),
      y: mm(yMm + opts.offsetYMm),
      width: mm(g.cellWidthMm),
      height: mm(g.cellHeightMm),
      borderColor: rgb(0.15, 0.15, 0.15),
      borderWidth: mm(0.25),
    });
  }

  const modules = matrix.length + QUIET_ZONE_MODULES * 2;
  const wide = g.cellWidthMm >= g.cellHeightMm * 1.4;
  // QR target size: leave room for text
  let qrSideMm = wide
    ? Math.min(g.cellHeightMm - pad * 2, g.cellWidthMm * 0.42)
    : Math.min(g.cellWidthMm - pad * 2, g.cellHeightMm * 0.55);

  let moduleMm = qrSideMm / modules;
  if (moduleMm < MIN_MODULE_MM) {
    moduleMm = MIN_MODULE_MM;
    qrSideMm = moduleMm * modules;
    if (qrSideMm > g.cellWidthMm - pad * 2 || qrSideMm > g.cellHeightMm - pad * 2) {
      warnings.push(
        `Label ${item.tag || item.id}: cell too small for min QR module size — text may be omitted.`,
      );
    }
  }

  const modulePt = mm(moduleMm);
  const qrSidePt = modules * modulePt;

  let qrX = x0;
  let qrY = y0 + (innerH - qrSidePt) / 2;
  let textX = x0 + qrSidePt + mm(1.2);
  let textMaxW = innerW - qrSidePt - mm(1.2);
  let textYTop = y0 + innerH - mm(1);

  if (!wide) {
    // Stack: QR on top, text below
    qrX = x0 + (innerW - qrSidePt) / 2;
    qrY = y0 + innerH - qrSidePt;
    textX = x0;
    textMaxW = innerW;
    textYTop = qrY - mm(0.8);
  }

  drawVectorQr(page, matrix, qrX, qrY, modulePt);

  const lines: { text: string; size: number; bold?: boolean }[] = [];
  if (opts.showTagUnderQr) {
    lines.push({ text: truncate(item.tag || item.id, 28), size: wide ? 7 : 6, bold: true });
  }
  if (opts.showName && item.name) {
    lines.push({ text: truncate(item.name, wide ? 36 : 28), size: 6 });
  }
  if (opts.showSerial && item.serial) {
    lines.push({ text: truncate(`S/N ${item.serial}`, 28), size: 5.5 });
  }
  if (opts.showOrg && item.org_name) {
    lines.push({ text: truncate(item.org_name, 28), size: 5 });
  }

  // Min 6pt; shrink if needed
  let cursorY = textYTop;
  const minBottom = y0 + mm(0.4);
  for (const line of lines) {
    if (!line.text) continue;
    const size = Math.max(6, line.size);
    const usedFont = line.bold ? fontBold : font;
    let drawSize = size;
    try {
      const textWidth = usedFont.widthOfTextAtSize(line.text, size);
      if (textWidth > textMaxW && textMaxW > 0) {
        drawSize = Math.max(line.bold ? 6 : 5, (size * textMaxW) / textWidth);
      }
    } catch {
      drawSize = size;
    }
    cursorY -= drawSize;
    if (cursorY < minBottom) break;
    safeDrawText(page, line.text, {
      x: textX,
      y: cursorY,
      size: drawSize,
      font: usedFont,
      color: rgb(0, 0, 0),
      maxWidth: textMaxW > 0 ? textMaxW : undefined,
    });
    cursorY -= mm(0.6);
  }
}

export async function buildLabelsPdf(
  items: EquipmentLabel[],
  opts: LabelRenderOptions,
): Promise<LabelPdfResult> {
  const g: SheetGeometry = { ...opts.preset.geometry, ...opts.geometryOverride };
  const warnings: string[] = [];
  const sorted = opts.testPrintOnly ? [] : sortLabels(items, opts.sortBy);
  const doc = await PDFDocument.create();
  doc.setTitle("TheTruegage Labels");
  doc.setCreator("TheTruegage");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const perPage = labelsPerSheet(g);
  const pageWidth = mm(g.pageWidthMm);
  const pageHeight = mm(g.pageHeightMm);

  if (opts.testPrintOnly) {
    const page = doc.addPage([pageWidth, pageHeight]);
    drawCutGuides(page, g, opts.cutGuides === "none" ? "dashed" : opts.cutGuides, opts.offsetXMm, opts.offsetYMm);
    safeDrawText(page, "TheTruegage alignment test - print at 100% / Actual size", {
      x: mm(g.marginLeftMm || 8),
      y: mm(4),
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    const bytes = await doc.save();
    return {
      bytes,
      filename: `TheTruegage-Labels-test-${new Date().toISOString().slice(0, 10)}.pdf`,
      pageCount: 1,
      warnings,
    };
  }

  // Precompute QR matrices
  const matrices = await Promise.all(
    sorted.map((item) => qrMatrix(labelUrl(item.qr_token), opts.ecc)),
  );

  let cursor = opts.startCell;
  let page: PDFPage | null = null;
  let pageIndex = -1;
  const totalPages = Math.max(1, Math.ceil((opts.startCell + sorted.length) / perPage));

  for (let i = 0; i < sorted.length; i++) {
    const cellOnPage = cursor % perPage;
    if (cellOnPage === 0 || page === null) {
      page = doc.addPage([pageWidth, pageHeight]);
      pageIndex += 1;
      // Always draw cut guides when requested (default for A4 print & cut)
      if (opts.cutGuides !== "none") {
        drawCutGuides(page, g, opts.cutGuides, opts.offsetXMm, opts.offsetYMm);
      } else if (opts.preset.mode === "print_cut") {
        drawCutGuides(page, g, "dashed", opts.offsetXMm, opts.offsetYMm);
      }
      if (opts.preset.mode === "print_cut" || opts.preset.mode === "precut") {
        safeDrawText(
          page,
          `TheTruegage labels - page ${pageIndex + 1} of ${totalPages} - generated ${new Date().toISOString().slice(0, 10)}`,
          {
            x: mm(Math.max(g.marginLeftMm, 6)),
            y: mm(3),
            size: 7,
            font,
            color: rgb(0.45, 0.45, 0.45),
          },
        );
      }
    }
    drawLabelContent(page!, font, fontBold, sorted[i], matrices[i], g, cellOnPage, opts, warnings);
    cursor += 1;
  }

  if (doc.getPageCount() === 0) {
    doc.addPage([pageWidth, pageHeight]);
  }

  const bytes = await doc.save();
  const date = new Date().toISOString().slice(0, 10);
  return {
    bytes,
    filename: `TheTruegage-Labels-${date}-${sorted.length}.pdf`,
    pageCount: doc.getPageCount(),
    warnings,
  };
}

function pdfBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = pdfBlob(bytes);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPdfForPrint(bytes: Uint8Array) {
  const blob = pdfBlob(bytes);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (w) {
    w.addEventListener("load", () => {
      try {
        w.print();
      } catch {
        /* user can print manually */
      }
    });
  }
  // Revoke later so the tab can load
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
