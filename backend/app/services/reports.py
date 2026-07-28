"""Generate downloadable compliance / equipment reports (CSV + PDF)."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Literal

from fpdf import FPDF

from app.models import EquipmentCache

ReportType = Literal["inventory", "overdue", "due", "compliance"]
ReportFormat = Literal["csv", "pdf"]

REPORT_LABELS: dict[str, str] = {
    "inventory": "Full equipment inventory",
    "overdue": "Overdue / failed equipment",
    "due": "Due within 30 days",
    "compliance": "Compliance summary",
}

CSV_HEADERS = [
    "tag",
    "name",
    "category",
    "department",
    "location",
    "serial",
    "status",
    "last_calibration",
    "next_calibration",
    "owner",
]


@dataclass
class ReportBundle:
    filename: str
    media_type: str
    content: bytes
    row_count: int
    label: str


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _days_until(row: EquipmentCache, today: date) -> int | None:
    if row.next_calibration is None:
        return None
    return (row.next_calibration - today).days


def filter_equipment(
    rows: list[EquipmentCache],
    report_type: ReportType,
    today: date | None = None,
) -> list[EquipmentCache]:
    today = today or _today()
    if report_type == "inventory":
        return list(rows)
    if report_type == "compliance":
        # Full inventory for the detail table; summary uses all rows.
        return list(rows)
    if report_type == "overdue":
        out: list[EquipmentCache] = []
        for r in rows:
            days = _days_until(r, today)
            if r.status in ("overdue", "failed") or (days is not None and days < 0):
                out.append(r)
        return out
    # due within 30 days
    out = []
    for r in rows:
        days = _days_until(r, today)
        if days is not None and 0 <= days <= 30:
            out.append(r)
    return out


def compliance_stats(rows: list[EquipmentCache], today: date | None = None) -> dict[str, int]:
    today = today or _today()
    active = [r for r in rows if r.status != "inactive"]
    calibrated = sum(1 for r in active if r.status == "calibrated")
    overdue = 0
    due_soon = 0
    failed = 0
    inactive = sum(1 for r in rows if r.status == "inactive")
    for r in rows:
        days = _days_until(r, today)
        if r.status == "failed":
            failed += 1
        if r.status == "overdue" or (days is not None and days < 0):
            overdue += 1
        elif days is not None and 0 <= days <= 30:
            due_soon += 1
    readiness = int(round((calibrated / len(active)) * 100)) if active else 0
    return {
        "total": len(rows),
        "active": len(active),
        "calibrated": calibrated,
        "overdue": overdue,
        "due_soon": due_soon,
        "failed": failed,
        "inactive": inactive,
        "readiness": readiness,
    }


def build_csv(rows: list[EquipmentCache]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_HEADERS)
    for r in rows:
        writer.writerow(
            [
                r.tag or "",
                r.name or "",
                r.category or "",
                r.department or "",
                r.location or "",
                r.serial or "",
                r.status or "",
                r.last_calibration.isoformat() if r.last_calibration else "",
                r.next_calibration.isoformat() if r.next_calibration else "",
                r.owner or "",
            ]
        )
    # UTF-8 BOM helps Excel open CSV correctly
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


class _ReportPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", size=8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"Page {self.page_no()}", align="C")


def _pdf_safe(text: str, max_len: int | None = None) -> str:
    """Helvetica (core PDF fonts) only support Latin-1; strip/replace other glyphs."""
    if not text:
        return ""
    replacements = {
        "\u2014": "-",  # em dash
        "\u2013": "-",  # en dash
        "\u00b7": "-",  # middle dot
        "\u2022": "*",  # bullet
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
    }
    out = str(text)
    for src, dst in replacements.items():
        out = out.replace(src, dst)
    out = out.encode("latin-1", errors="replace").decode("latin-1")
    if max_len is not None:
        out = out[:max_len]
    return out


def build_pdf(
    *,
    tenant_name: str,
    report_type: ReportType,
    rows: list[EquipmentCache],
    all_rows: list[EquipmentCache] | None = None,
) -> bytes:
    today = _today()
    stats = compliance_stats(all_rows if all_rows is not None else rows, today)
    label = REPORT_LABELS.get(report_type, report_type)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    pdf = _ReportPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()

    pdf.set_font("Helvetica", style="B", size=16)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 8, "TrueGage Compliance Report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=11)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 6, _pdf_safe(tenant_name or "Workspace"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, _pdf_safe(f"{label}  |  Generated {generated}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Summary box
    pdf.set_font("Helvetica", style="B", size=12)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 7, "Summary", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=10)
    pdf.set_text_color(40, 40, 40)
    summary_lines = [
        f"Audit readiness: {stats['readiness']}%",
        f"Total equipment: {stats['total']}  |  Active: {stats['active']}  |  Calibrated: {stats['calibrated']}",
        f"Overdue: {stats['overdue']}  |  Due within 30 days: {stats['due_soon']}  |  Failed: {stats['failed']}",
        f"Inactive: {stats['inactive']}",
        f"Rows in this report: {len(rows)}",
    ]
    for line in summary_lines:
        pdf.cell(0, 5.5, _pdf_safe(line), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Table
    pdf.set_font("Helvetica", style="B", size=12)
    pdf.cell(0, 7, "Equipment detail", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    col_w = [28, 52, 28, 24, 28, 30]
    headers = ["Tag", "Name", "Category", "Status", "Next due", "Department"]
    pdf.set_font("Helvetica", style="B", size=8)
    pdf.set_fill_color(240, 240, 240)
    for i, h in enumerate(headers):
        pdf.cell(col_w[i], 6, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", size=8)
    if not rows:
        pdf.cell(0, 8, "No equipment matched this report.", new_x="LMARGIN", new_y="NEXT")
    else:
        for r in rows:
            cells = [
                _pdf_safe(r.tag or "", 18),
                _pdf_safe(r.name or "", 32),
                _pdf_safe(r.category or "", 16),
                _pdf_safe(r.status or "", 14),
                r.next_calibration.isoformat() if r.next_calibration else "-",
                _pdf_safe(r.department or "", 18),
            ]
            # Page break before row if needed
            if pdf.get_y() > 270:
                pdf.add_page()
                pdf.set_font("Helvetica", style="B", size=8)
                pdf.set_fill_color(240, 240, 240)
                for i, h in enumerate(headers):
                    pdf.cell(col_w[i], 6, h, border=1, fill=True)
                pdf.ln()
                pdf.set_font("Helvetica", size=8)
            for i, c in enumerate(cells):
                pdf.cell(col_w[i], 5.5, c, border=1)
            pdf.ln()

    pdf.ln(6)
    pdf.set_font("Helvetica", size=8)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(
        0,
        4,
        "This report was generated by TrueGage from live workspace data. "
        "Statuses reflect calibration due dates at generation time.",
    )

    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1")


def make_report(
    *,
    tenant_name: str,
    tenant_slug: str,
    report_type: ReportType,
    fmt: ReportFormat,
    rows: list[EquipmentCache],
) -> ReportBundle:
    today = _today()
    filtered = filter_equipment(rows, report_type, today)
    label = REPORT_LABELS.get(report_type, report_type)
    stamp = today.isoformat()
    safe_slug = (tenant_slug or "workspace").strip() or "workspace"

    if fmt == "csv":
        content = build_csv(filtered)
        filename = f"TrueGage-{safe_slug}-{report_type}-{stamp}.csv"
        return ReportBundle(
            filename=filename,
            media_type="text/csv; charset=utf-8",
            content=content,
            row_count=len(filtered),
            label=label,
        )

    content = build_pdf(
        tenant_name=tenant_name,
        report_type=report_type,
        rows=filtered,
        all_rows=rows,
    )
    filename = f"TrueGage-{safe_slug}-{report_type}-{stamp}.pdf"
    return ReportBundle(
        filename=filename,
        media_type="application/pdf",
        content=content,
        row_count=len(filtered),
        label=label,
    )
