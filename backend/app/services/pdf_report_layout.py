"""Shared Thetruegage professional PDF report layout (fpdf2).

Brand chrome uses the product teal theme and the official logo asset.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from fpdf import FPDF
from fpdf.enums import Corner, RenderStyle

# --- Design tokens (hex -> RGB) — Thetruegage teal theme ----------------------

BRAND = (15, 118, 110)  # #0F766E primary
TEAL = (13, 148, 136)  # #0D9488 accent
TEAL_MARK = (20, 145, 138)  # #14918A logo field
TEAL_LIGHT = (230, 255, 250)  # #E6FFFA on-teal eyebrow / tagline
TEAL_NEEDLE = (60, 199, 181)  # fallback vector needle
GREEN = (30, 158, 90)
AMBER = (217, 154, 0)
RED = (214, 69, 69)
MAROON = (142, 27, 58)
SLATE = (122, 133, 148)
TEXT = (31, 41, 55)
MUTED = (91, 102, 117)
LIGHT = (243, 246, 250)
BORDER = (221, 227, 234)
WHITE = (255, 255, 255)

# Alias used by KPI cards / headings that previously used navy
NAVY = BRAND

BRAND_NAME = "Thetruegage"
BRAND_SITE = "app.thetruegage.com"
LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "thetruegage-logo.png"

STATUS_COLORS: dict[str, tuple[int, int, int]] = {
    "calibrated": GREEN,
    "due_soon": AMBER,
    "due soon": AMBER,
    "overdue": RED,
    "failed": MAROON,
    "inactive": SLATE,
    "pass": GREEN,
    "attention": AMBER,
    "fail": RED,
}

MARGIN_X = 18.0
MARGIN_BOTTOM = 22.0
PAGE1_TOP = 46.0
LATER_TOP = 22.0
CONTENT_WIDTH = 210.0 - 2 * MARGIN_X  # A4


def hex_tint(rgb: tuple[int, int, int], opacity: float) -> tuple[int, int, int]:
    """Blend colour toward white at (1 - opacity)."""
    o = max(0.0, min(1.0, opacity))
    return tuple(int(round(c * o + 255 * (1 - o))) for c in rgb)  # type: ignore[return-value]


def pdf_safe(text: str, max_len: int | None = None) -> str:
    """Helvetica core fonts are Latin-1; normalize fancy punctuation."""
    if not text:
        return ""
    replacements = {
        "\u2014": "-",
        "\u2013": "-",
        "\u00b7": "-",
        "\u2022": "*",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
        "\u00a0": " ",
    }
    out = str(text)
    for src, dst in replacements.items():
        out = out.replace(src, dst)
    out = out.encode("latin-1", errors="replace").decode("latin-1")
    if max_len is not None and len(out) > max_len:
        if max_len > 3:
            out = out[: max_len - 3] + "..."
        else:
            out = out[:max_len]
        out = out.encode("latin-1", errors="replace").decode("latin-1")
    return out


def status_rgb(status: str) -> tuple[int, int, int]:
    key = (status or "").strip().lower().replace("-", "_")
    return STATUS_COLORS.get(key, SLATE)


def readiness_rgb(pct: int) -> tuple[int, int, int]:
    if pct >= 90:
        return GREEN
    if pct >= 75:
        return AMBER
    return RED


@dataclass
class ReportChrome:
    org_name: str
    report_title: str
    report_id: str
    generated_label: str  # e.g. "21 Oct 2026, 2:30 PM IST"
    cover_eyebrow: str = "REPORTS & COMPLIANCE"


@dataclass
class MetaField:
    label: str
    value: str


@dataclass
class KpiCard:
    title: str
    value: str
    subtitle: str
    accent: tuple[int, int, int]


@dataclass
class TableColumn:
    key: str
    header: str
    width: float
    align: str = "L"  # L C R
    no_wrap: bool = False


@dataclass
class CheckRow:
    check: str
    result: str
    status: str  # Pass / Attention / Fail


@dataclass
class CategoryRate:
    category: str
    calibrated: int
    total: int
    rate: int


@dataclass
class MonthBar:
    label: str
    count: int
    is_current: bool = False


@dataclass
class ReportContext:
    chrome: ReportChrome
    meta: list[MetaField] = field(default_factory=list)
    kpis: list[KpiCard] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)
    checks: list[CheckRow] = field(default_factory=list)
    categories: list[CategoryRate] = field(default_factory=list)
    month_bars: list[MonthBar] = field(default_factory=list)
    description: str = ""


class TrueGageReportPDF(FPDF):
    """A4 portrait report with branded header/footer chrome."""

    def __init__(self, chrome: ReportChrome) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.chrome = chrome
        self.set_margins(MARGIN_X, PAGE1_TOP, MARGIN_X)
        self.set_auto_page_break(auto=True, margin=MARGIN_BOTTOM)
        self.alias_nb_pages()
        title = pdf_safe(f"{chrome.report_title} | {chrome.org_name}", 180)
        self.set_title(title)
        self.set_author(BRAND_NAME)
        self.set_creator(f"{BRAND_NAME} ({BRAND_SITE})")
        self.set_producer(BRAND_NAME)

    # -- Header / footer -------------------------------------------------------

    def header(self) -> None:
        if self.page_no() == 1:
            self._draw_cover_header()
            self.set_y(PAGE1_TOP + 2)
        else:
            self.set_top_margin(LATER_TOP)
            self._draw_cont_header()
            self.set_y(LATER_TOP + 1)

    def footer(self) -> None:
        self.set_y(-18)
        # Line 1: branding + page
        self.set_font("Helvetica", "B", 7)
        self.set_text_color(*BRAND)
        left = f"Report generated by {BRAND_NAME}"
        self.set_xy(MARGIN_X, -18)
        self.cell(self.get_string_width(left), 4, left, align="L")
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*MUTED)
        rest = f" | {BRAND_SITE}"
        self.cell(self.get_string_width(rest), 4, rest, align="L")
        self.set_xy(MARGIN_X, -18)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*MUTED)
        self.cell(CONTENT_WIDTH, 4, f"Page {self.page_no()} of {{nb}}", align="R")
        # Line 2: confidential
        self.set_xy(MARGIN_X, -13)
        self.set_font("Helvetica", "", 6.2)
        self.set_text_color(*SLATE)
        conf = (
            f"Confidential. For authorized use only. Generated {pdf_safe(self.chrome.generated_label)} "
            "| Based on live equipment data at time of generation."
        )
        self.cell(CONTENT_WIDTH, 3.5, pdf_safe(conf, 140), align="L")

    def _draw_cover_header(self) -> None:
        band_h = 40.0
        self.set_fill_color(*BRAND)
        self.rect(0, 0, 210, band_h, style="F")
        self.set_fill_color(*TEAL)
        self.rect(0, band_h, 210, 1.6, style="F")

        self._place_logo(MARGIN_X, 10, size=18)

        self.set_xy(MARGIN_X + 22, 11)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*WHITE)
        self.cell(70, 7, BRAND_NAME, align="L")
        self.set_xy(MARGIN_X + 22, 19)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*TEAL_LIGHT)
        self.cell(70, 5, "Calibration Made Simple", align="L")

        # Right cluster
        right_x = 210 - MARGIN_X - 70
        self.set_xy(right_x, 10)
        self.set_font("Helvetica", "B", 7)
        self.set_text_color(*TEAL_LIGHT)
        self.cell(70, 4, pdf_safe(self.chrome.cover_eyebrow), align="R")
        self.set_xy(right_x, 16)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*WHITE)
        self.cell(70, 5, pdf_safe(self.chrome.org_name, 42), align="R")
        self.set_xy(right_x, 23)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(200, 235, 230)
        self.cell(70, 4, pdf_safe(f"Report ID {self.chrome.report_id}"), align="R")

    def _draw_cont_header(self) -> None:
        # Keep logo fully above the rule so it never straddles the divider.
        logo_size = 8.0
        logo_y = 5.0
        self._place_logo(MARGIN_X, logo_y, size=logo_size)
        text_h = 4.0
        text_y = logo_y + (logo_size - text_h) / 2
        self.set_xy(MARGIN_X + logo_size + 2.5, text_y)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*BRAND)
        self.cell(48, text_h, BRAND_NAME, align="L")
        self.set_xy(MARGIN_X, text_y)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        right = pdf_safe(f"{self.chrome.report_title} | {self.chrome.org_name}", 70)
        self.cell(CONTENT_WIDTH, text_h, right, align="R")
        line_y = logo_y + logo_size + 2.0
        self.set_draw_color(*BORDER)
        self.set_line_width(0.3)
        self.line(MARGIN_X, line_y, MARGIN_X + CONTENT_WIDTH, line_y)
        self.set_draw_color(*TEAL)
        self.set_line_width(0.8)
        self.line(MARGIN_X, line_y, MARGIN_X + 16, line_y)
        self.set_line_width(0.2)

    def _place_logo(self, x: float, y: float, size: float = 18) -> None:
        """Official Thetruegage logo PNG, with vector fallback."""
        if LOGO_PATH.is_file():
            self.image(str(LOGO_PATH), x=x, y=y, w=size, h=size)
            return
        self._draw_gauge_logo_fallback(x, y, size=size)

    def _draw_gauge_logo_fallback(self, x: float, y: float, size: float = 18) -> None:
        """Simple gauge mark if the PNG asset is missing."""
        self.set_fill_color(*TEAL_MARK)
        self._rounded_box(x, y, size, size, 3.0, style=RenderStyle.F)
        cx = x + size / 2
        cy = y + size / 2
        r = size / 2 - 2.5
        self.set_draw_color(34, 39, 43)
        self.set_line_width(1.2)
        self._arc(cx, cy + 1, r, 200, -20)
        angle = math.radians(-40)
        self.set_line_width(1.4)
        self.line(cx, cy + 1, cx + r * 0.7 * math.cos(angle), cy + 1 - r * 0.7 * math.sin(angle))
        self.set_fill_color(34, 39, 43)
        self.ellipse(cx - 1.2, cy + 1 - 1.2, 2.4, 2.4, style="F")
        self.set_line_width(0.2)

    # -- Spacing helpers -------------------------------------------------------

    def ensure_space(self, needed_mm: float) -> None:
        if self.get_y() + needed_mm > 297 - MARGIN_BOTTOM - 2:
            self.add_page()

    def section_title(self, title: str, subtitle: str = "") -> None:
        self.ensure_space(14 if subtitle else 10)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*NAVY)
        self.cell(CONTENT_WIDTH, 6, pdf_safe(title), new_x="LMARGIN", new_y="NEXT")
        if subtitle:
            self.set_font("Helvetica", "", 7.5)
            self.set_text_color(*MUTED)
            self.multi_cell(CONTENT_WIDTH, 4, pdf_safe(subtitle))
        self.ln(1.5)

    def draw_title_block(self, title: str, description: str) -> None:
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(*NAVY)
        self.multi_cell(CONTENT_WIDTH, 9, pdf_safe(title))
        self.ln(1)
        self.set_font("Helvetica", "", 8.4)
        self.set_text_color(*MUTED)
        self.multi_cell(CONTENT_WIDTH, 4.2, pdf_safe(description))
        self.ln(3)

    def draw_metadata_grid(self, fields: Sequence[MetaField]) -> None:
        self.ensure_space(28)
        row_h = 11.0
        cols = 3
        cell_w = CONTENT_WIDTH / cols
        self.set_fill_color(*LIGHT)
        self.set_draw_color(*BORDER)
        self.set_line_width(0.3)
        y0 = self.get_y()
        # background
        rows = (len(fields) + cols - 1) // cols
        self.rect(MARGIN_X, y0, CONTENT_WIDTH, rows * row_h, style="DF")
        for i, f in enumerate(fields):
            r, c = divmod(i, cols)
            x = MARGIN_X + c * cell_w
            y = y0 + r * row_h
            self.set_xy(x + 2.5, y + 1.5)
            self.set_font("Helvetica", "B", 6.2)
            self.set_text_color(*SLATE)
            self.cell(cell_w - 5, 3, pdf_safe(f.label.upper()), align="L")
            self.set_xy(x + 2.5, y + 5)
            self.set_font("Helvetica", "B", 8)
            self.set_text_color(*TEXT)
            self.cell(cell_w - 5, 4, pdf_safe(f.value, 36), align="L")
        self.set_y(y0 + rows * row_h + 4)

    def draw_kpi_row(self, cards: Sequence[KpiCard]) -> None:
        if not cards:
            return
        n = len(cards)
        gap = 2.5
        card_w = (CONTENT_WIDTH - gap * (n - 1)) / n
        card_h = 22.0
        self.ensure_space(card_h + 4)
        y0 = self.get_y()
        for i, card in enumerate(cards):
            x = MARGIN_X + i * (card_w + gap)
            self.set_fill_color(*WHITE)
            self.set_draw_color(*BORDER)
            self.rect(x, y0, card_w, card_h, style="DF")
            self.set_fill_color(*card.accent)
            self.rect(x, y0, card_w, 1.4, style="F")
            self.set_xy(x + 2.5, y0 + 3.5)
            self.set_font("Helvetica", "B", 6.2)
            self.set_text_color(*SLATE)
            self.cell(card_w - 5, 3, pdf_safe(card.title.upper()), align="L")
            self.set_xy(x + 2.5, y0 + 8)
            self.set_font("Helvetica", "B", 14)
            self.set_text_color(*NAVY)
            self.cell(card_w - 5, 6, pdf_safe(card.value), align="L")
            self.set_xy(x + 2.5, y0 + 15.5)
            self.set_font("Helvetica", "", 6.5)
            self.set_text_color(*MUTED)
            self.cell(card_w - 5, 3.5, pdf_safe(card.subtitle, 28), align="L")
        self.set_y(y0 + card_h + 5)

    def _rounded_box(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        r: float,
        style: RenderStyle = RenderStyle.DF,
    ) -> None:
        corners = (
            Corner.TOP_LEFT,
            Corner.TOP_RIGHT,
            Corner.BOTTOM_LEFT,
            Corner.BOTTOM_RIGHT,
        )
        radius = min(r, h / 2, w / 2)
        self._draw_rounded_rect(x, y, w, h, style, corners, radius)

    def draw_status_pill(self, x: float, y: float, w: float, h: float, label: str) -> None:
        rgb = status_rgb(label)
        fill = hex_tint(rgb, 0.15)
        border = hex_tint(rgb, 0.55)
        self.set_fill_color(*fill)
        self.set_draw_color(*border)
        self.set_line_width(0.4)
        self._rounded_box(x, y, w, h, h / 2, style=RenderStyle.DF)
        self.set_xy(x, y + 0.4)
        self.set_font("Helvetica", "B", 6.6)
        self.set_text_color(*rgb)
        self.cell(w, h - 0.6, pdf_safe(label.upper()), align="C")
        self.set_line_width(0.2)

    def draw_readiness_hero(self, stats: dict[str, int]) -> None:
        """Semicircle gauge + stacked status bar."""
        self.ensure_space(52)
        y0 = self.get_y()
        gauge_w = 72.0
        bar_x = MARGIN_X + gauge_w + 8
        bar_w = CONTENT_WIDTH - gauge_w - 8

        readiness = int(stats.get("readiness", 0))
        color = readiness_rgb(readiness)
        # Gauge card
        self.set_fill_color(*WHITE)
        self.set_draw_color(*BORDER)
        self.rect(MARGIN_X, y0, gauge_w, 48, style="DF")
        cx = MARGIN_X + gauge_w / 2
        cy = y0 + 28
        r = 22
        # background arc (light)
        self.set_draw_color(*BORDER)
        self.set_line_width(4)
        self._arc(cx, cy, r, 180, 0)
        # value arc
        self.set_draw_color(*color)
        sweep = 180 * max(0, min(100, readiness)) / 100.0
        self._arc(cx, cy, r, 180, 180 - sweep)
        self.set_line_width(0.2)
        self.set_xy(MARGIN_X + 4, y0 + 22)
        self.set_font("Helvetica", "B", 20)
        self.set_text_color(*color)
        self.cell(gauge_w - 8, 8, f"{readiness}%", align="C")
        self.set_xy(MARGIN_X + 4, y0 + 32)
        self.set_font("Helvetica", "B", 7)
        self.set_text_color(*NAVY)
        self.cell(gauge_w - 8, 4, "AUDIT READINESS INDEX", align="C")
        self.set_xy(MARGIN_X + 4, y0 + 37)
        self.set_font("Helvetica", "", 6.2)
        self.set_text_color(*MUTED)
        self.cell(gauge_w - 8, 3.5, "ISO 9001 / ISO 17025", align="C")

        # Status breakdown
        self.set_fill_color(*WHITE)
        self.set_draw_color(*BORDER)
        self.rect(bar_x, y0, bar_w, 48, style="DF")
        self.set_xy(bar_x + 3, y0 + 3)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*NAVY)
        self.cell(bar_w - 6, 4, "Equipment status breakdown", align="L")

        total = max(1, int(stats.get("total", 0)))
        segments = [
            ("Calibrated", int(stats.get("calibrated", 0)), GREEN),
            ("Due Soon", int(stats.get("due_soon", 0)), AMBER),
            ("Overdue", int(stats.get("overdue", 0)), RED),
            ("Failed", int(stats.get("failed", 0)), MAROON),
            ("Inactive", int(stats.get("inactive", 0)), SLATE),
        ]
        # stacked bar
        bx = bar_x + 3
        by = y0 + 10
        bw = bar_w - 6
        self.set_fill_color(*LIGHT)
        self.rect(bx, by, bw, 5, style="F")
        xcursor = bx
        for _, count, rgb in segments:
            if count <= 0:
                continue
            w = bw * (count / total)
            self.set_fill_color(*rgb)
            self.rect(xcursor, by, max(0.4, w), 5, style="F")
            xcursor += w

        ly = y0 + 18
        for label, count, rgb in segments:
            pct = int(round(100 * count / total)) if total else 0
            self.set_fill_color(*rgb)
            self.rect(bar_x + 3, ly + 1.2, 3, 3, style="F")
            self.set_xy(bar_x + 8, ly)
            self.set_font("Helvetica", "", 7.2)
            self.set_text_color(*TEXT)
            self.cell(38, 5, label, align="L")
            self.set_font("Helvetica", "B", 7.2)
            self.cell(14, 5, str(count), align="R")
            self.set_font("Helvetica", "", 7.2)
            self.set_text_color(*MUTED)
            self.cell(16, 5, f"{pct}%", align="R")
            ly += 5.5

        self.set_y(y0 + 52)

    def _arc(self, cx: float, cy: float, r: float, start_deg: float, end_deg: float) -> None:
        """Approximate arc with short line segments (degrees, CCW from +x)."""
        # Convert to math angles where 0 is +x, positive CCW; our start 180 = left
        steps = max(8, int(abs(end_deg - start_deg) / 3))
        if steps == 0:
            return
        pts = []
        for i in range(steps + 1):
            t = i / steps
            deg = start_deg + (end_deg - start_deg) * t
            rad = math.radians(deg)
            pts.append((cx + r * math.cos(rad), cy - r * math.sin(rad)))
        for i in range(len(pts) - 1):
            self.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])

    def draw_checks_table(self, rows: Sequence[CheckRow]) -> None:
        self.section_title("Compliance checks", "Automated checks against live register data.")
        cols = [
            TableColumn("check", "CHECK", 62),
            TableColumn("result", "RESULT", 78),
            TableColumn("status", "STATUS", 34, align="C"),
        ]
        data = [{"check": r.check, "result": r.result, "status": r.status} for r in rows]
        self.draw_table(cols, data, empty_message="No compliance checks available.", status_key="status")

    def draw_category_rates(self, rows: Sequence[CategoryRate]) -> None:
        self.section_title(
            "Category compliance rates",
            "Calibrated gauges as a share of active gauges in each category.",
        )
        if not rows:
            self._empty_box("No category data yet.")
            return
        self.ensure_space(12)
        # header
        headers = [("CATEGORY", 48), ("CALIBRATED", 24), ("TOTAL", 20), ("", 50), ("RATE", 22)]
        self._table_header_simple(headers)
        for i, row in enumerate(rows):
            self.ensure_space(8)
            y = self.get_y()
            fill = LIGHT if i % 2 == 0 else WHITE
            self.set_fill_color(*fill)
            self.rect(MARGIN_X, y, CONTENT_WIDTH, 7.5, style="F")
            self.set_draw_color(*BORDER)
            self.line(MARGIN_X, y + 7.5, MARGIN_X + CONTENT_WIDTH, y + 7.5)
            self.set_xy(MARGIN_X + 2, y + 1.5)
            self.set_font("Helvetica", "", 7.4)
            self.set_text_color(*TEXT)
            self.cell(46, 4.5, pdf_safe(row.category, 28), align="L")
            self.cell(24, 4.5, str(row.calibrated), align="C")
            self.cell(20, 4.5, str(row.total), align="C")
            # progress
            bar_x = MARGIN_X + 2 + 46 + 24 + 20 + 2
            bar_w = 46
            self.set_fill_color(*LIGHT)
            self.rect(bar_x, y + 2.2, bar_w, 3.2, style="F")
            pct = max(0, min(100, row.rate)) / 100.0
            self.set_fill_color(*readiness_rgb(row.rate))
            self.rect(bar_x, y + 2.2, bar_w * pct, 3.2, style="F")
            self.set_xy(MARGIN_X + CONTENT_WIDTH - 24, y + 1.5)
            self.set_font("Helvetica", "B", 7.4)
            self.set_text_color(*readiness_rgb(row.rate))
            self.cell(22, 4.5, f"{row.rate}%", align="R")
            self.set_y(y + 7.5)
        self.ln(3)

    def draw_month_bars(self, bars: Sequence[MonthBar]) -> None:
        self.section_title("Calibrations logged: last 6 months", "Verification activity per month.")
        if not bars:
            self._empty_box("No calibrations logged in the last 6 months.")
            return
        self.ensure_space(42)
        y0 = self.get_y()
        chart_h = 32.0
        max_count = max((b.count for b in bars), default=1) or 1
        n = len(bars)
        gap = 4.0
        bar_w = (CONTENT_WIDTH - gap * (n - 1)) / n
        for i, b in enumerate(bars):
            x = MARGIN_X + i * (bar_w + gap)
            h = (chart_h - 10) * (b.count / max_count) if max_count else 0
            by = y0 + (chart_h - 10) - h
            color = TEAL if b.is_current else hex_tint(TEAL, 0.45)
            self.set_fill_color(*color)
            self.rect(x + 2, by, bar_w - 4, max(0.8, h), style="F")
            self.set_xy(x, by - 4)
            self.set_font("Helvetica", "B", 7)
            self.set_text_color(*NAVY)
            self.cell(bar_w, 3.5, str(b.count), align="C")
            self.set_xy(x, y0 + chart_h - 8)
            self.set_font("Helvetica", "", 7)
            self.set_text_color(*MUTED)
            self.cell(bar_w, 4, pdf_safe(b.label), align="C")
        self.set_y(y0 + chart_h + 2)

    def draw_sign_off_and_closing(self) -> None:
        """Keep sign-off + closing block together (no orphan closing page)."""
        block_h = 58.0
        self.ensure_space(block_h)
        self.section_title("Review & sign-off")
        roles = [
            ("PREPARED BY", "Name / Signature / Date"),
            ("REVIEWED BY (QA)", "Name / Signature / Date"),
            ("APPROVED BY", "Name / Signature / Date"),
        ]
        gap = 3.0
        box_w = (CONTENT_WIDTH - 2 * gap) / 3
        y0 = self.get_y()
        box_h = 22.0
        for i, (label, hint) in enumerate(roles):
            x = MARGIN_X + i * (box_w + gap)
            self.set_draw_color(*BORDER)
            self.set_fill_color(*WHITE)
            self.rect(x, y0, box_w, box_h, style="DF")
            self.set_xy(x + 2, y0 + 2)
            self.set_font("Helvetica", "B", 6.2)
            self.set_text_color(*SLATE)
            self.cell(box_w - 4, 3, label, align="L")
            # signature line
            self.set_draw_color(*BORDER)
            self.line(x + 2, y0 + 14, x + box_w - 2, y0 + 14)
            self.set_xy(x + 2, y0 + 15.5)
            self.set_font("Helvetica", "", 6)
            self.set_text_color(*SLATE)
            self.cell(box_w - 4, 3, hint, align="L")
        self.set_y(y0 + box_h + 4)

        self.set_font("Helvetica", "", 6.5)
        self.set_text_color(*MUTED)
        note = (
            "Audit readiness = calibrated share of active equipment. "
            "Inactive equipment is excluded. Figures reflect the register at the time of generation."
        )
        self.multi_cell(CONTENT_WIDTH, 3.5, pdf_safe(note))
        self.ln(3)
        self._draw_closing_block()

    def _draw_closing_block(self) -> None:
        self.ensure_space(28)
        y0 = self.get_y()
        h = 26.0
        self.set_fill_color(*BRAND)
        self._rounded_box(MARGIN_X, y0, CONTENT_WIDTH, h, 2.5, style=RenderStyle.F)
        self._place_logo(MARGIN_X + 4, y0 + 4, size=16)
        self.set_xy(MARGIN_X + 24, y0 + 4)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*WHITE)
        self.cell(100, 5, f"Report generated by {BRAND_NAME}", align="L")
        self.set_xy(MARGIN_X + 24, y0 + 10)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(*TEAL_LIGHT)
        self.cell(100, 4, f"Calibration Made Simple | {BRAND_SITE}", align="L")
        self.set_xy(MARGIN_X + 24, y0 + 16)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(200, 235, 230)
        self.cell(100, 3.5, pdf_safe(f"Report ID {self.chrome.report_id}"), align="L")
        self.set_xy(MARGIN_X + 24, y0 + 20)
        self.cell(100, 3.5, pdf_safe(f"Generated {self.chrome.generated_label}"), align="L")
        self.set_y(y0 + h + 2)

    def _empty_box(self, message: str) -> None:
        self.ensure_space(14)
        y = self.get_y()
        self.set_fill_color(*LIGHT)
        self.set_draw_color(*BORDER)
        self.rect(MARGIN_X, y, CONTENT_WIDTH, 12, style="DF")
        self.set_xy(MARGIN_X + 3, y + 3.5)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(CONTENT_WIDTH - 6, 5, pdf_safe(message), align="L")
        self.set_y(y + 14)

    def _table_header_simple(self, headers: list[tuple[str, float]]) -> None:
        y = self.get_y()
        self.set_fill_color(*NAVY)
        self.rect(MARGIN_X, y, CONTENT_WIDTH, 6.5, style="F")
        self.set_xy(MARGIN_X + 2, y + 1.2)
        self.set_font("Helvetica", "B", 6.5)
        self.set_text_color(*WHITE)
        for label, w in headers:
            self.cell(w, 4, label, align="L")
        self.set_y(y + 6.5)

    def draw_table(
        self,
        columns: Sequence[TableColumn],
        rows: Sequence[dict[str, str]],
        *,
        empty_message: str,
        status_key: str | None = None,
        row_height: float = 7.0,
    ) -> None:
        if not rows:
            self._empty_box(empty_message)
            return

        def paint_header() -> None:
            y = self.get_y()
            self.set_fill_color(*NAVY)
            self.rect(MARGIN_X, y, CONTENT_WIDTH, 6.5, style="F")
            self.set_xy(MARGIN_X + 1, y + 1.2)
            self.set_font("Helvetica", "B", 6.5)
            self.set_text_color(*WHITE)
            for col in columns:
                self.cell(col.width, 4, col.header, align=col.align)
            self.set_y(y + 6.5)

        self.ensure_space(6.5 + row_height)
        paint_header()

        for i, row in enumerate(rows):
            self.ensure_space(row_height + 0.5)
            # If we just broke, re-paint header
            if self.get_y() < LATER_TOP + 8 and self.page_no() > 1:
                # after page break header() already ran; still need table header
                pass
            # Detect fresh page (y near top margin)
            if self.page_no() > 1 and abs(self.get_y() - (LATER_TOP + 1)) < 2.5:
                paint_header()

            y = self.get_y()
            fill = LIGHT if i % 2 == 0 else WHITE
            self.set_fill_color(*fill)
            self.rect(MARGIN_X, y, CONTENT_WIDTH, row_height, style="F")
            self.set_draw_color(*BORDER)
            self.line(MARGIN_X, y + row_height, MARGIN_X + CONTENT_WIDTH, y + row_height)

            x = MARGIN_X + 1
            for col in columns:
                val = pdf_safe(str(row.get(col.key, "") or ""))
                if status_key and col.key == status_key:
                    pill_w = min(col.width - 1, 26)
                    pill_x = x + (col.width - pill_w) / 2 if col.align == "C" else x
                    self.draw_status_pill(pill_x, y + 1.2, pill_w, 4.6, val)
                else:
                    self.set_xy(x, y + 1.5)
                    self.set_font("Helvetica", "", 7.2)
                    self.set_text_color(*TEXT)
                    if col.no_wrap:
                        # truncate to fit
                        max_chars = max(4, int(col.width / 1.6))
                        self.cell(col.width, 4, pdf_safe(val, max_chars), align=col.align)
                    else:
                        # single-line truncate for reliability
                        max_chars = max(4, int(col.width / 1.55))
                        self.cell(col.width, 4, pdf_safe(val, max_chars), align=col.align)
                x += col.width
            self.set_y(y + row_height)
        self.ln(3)


def output_pdf_bytes(pdf: TrueGageReportPDF) -> bytes:
    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1")
