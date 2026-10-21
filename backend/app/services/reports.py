"""Generate downloadable compliance / equipment reports (CSV + PDF)."""

from __future__ import annotations

import csv
import io
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Literal, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.models import AuditEvent, CalibrationRecord, Certificate, EquipmentCache
from app.services.org_settings import format_date, format_datetime, local_today
from app.services.pdf_report_layout import (
    AMBER,
    GREEN,
    MAROON,
    NAVY,
    RED,
    SLATE,
    CategoryRate,
    CheckRow,
    KpiCard,
    MetaField,
    MonthBar,
    ReportChrome,
    TableColumn,
    TrueGageReportPDF,
    output_pdf_bytes,
)

ReportType = Literal["inventory", "overdue", "due", "compliance"]
ReportFormat = Literal["csv", "pdf"]

REPORT_LABELS: dict[str, str] = {
    "inventory": "Full inventory",
    "overdue": "Overdue / failed",
    "due": "Due within 30 days",
    "compliance": "Compliance summary",
}

REPORT_DESCRIPTIONS: dict[str, str] = {
    "inventory": "Complete equipment register with calibration status and due dates.",
    "overdue": "Equipment that is overdue or failed and requires immediate action.",
    "due": "Equipment due for calibration within the next 30 days.",
    "compliance": (
        "Calibration status and audit-readiness snapshot across all active equipment."
    ),
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

ROLE_LABELS: dict[str, str] = {
    "admin": "Admin",
    "qa": "QA",
    "technician": "Technician",
    "member": "Member",
    "platform_admin": "Thetruegage Admin",
}


@dataclass
class ReportBundle:
    filename: str
    media_type: str
    content: bytes
    row_count: int
    label: str
    report_id: str = ""


@dataclass
class ReportExtras:
    """Optional enrichment for PDF compliance sections."""

    certificate_equipment_ids: set[int] = field(default_factory=set)
    calibration_dates: list[date] = field(default_factory=list)
    generated_by_name: str = ""
    generated_by_role: str = ""
    filters_label: str = "All departments, all categories"
    report_id: str = ""
    tenant_id: int | None = None


def _days_until(row: EquipmentCache, today: date) -> int | None:
    if row.next_calibration is None:
        return None
    return (row.next_calibration - today).days


def filter_equipment(
    rows: list[EquipmentCache],
    report_type: ReportType,
    today: date,
) -> list[EquipmentCache]:
    if report_type in ("inventory", "compliance"):
        return list(rows)
    if report_type == "overdue":
        out: list[EquipmentCache] = []
        for r in rows:
            days = _days_until(r, today)
            if r.status in ("overdue", "failed") or (days is not None and days < 0):
                out.append(r)
        return out
    out = []
    for r in rows:
        days = _days_until(r, today)
        if days is not None and 0 <= days <= 30:
            out.append(r)
    return out


def compliance_stats(rows: list[EquipmentCache], today: date) -> dict[str, int]:
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
        elif days is not None and 0 <= days <= 30 and r.status != "failed":
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
        "overdue_failed": overdue + failed,
    }


def category_rates(rows: list[EquipmentCache]) -> list[CategoryRate]:
    buckets: dict[str, list[EquipmentCache]] = defaultdict(list)
    for r in rows:
        if r.status == "inactive":
            continue
        cat = (r.category or "").strip() or "Uncategorized"
        buckets[cat].append(r)
    out: list[CategoryRate] = []
    for cat, items in sorted(buckets.items(), key=lambda kv: kv[0].lower()):
        total = len(items)
        cal = sum(1 for i in items if i.status == "calibrated")
        rate = int(round((cal / total) * 100)) if total else 0
        out.append(CategoryRate(category=cat, calibrated=cal, total=total, rate=rate))
    return out


def attention_rows(rows: list[EquipmentCache], today: date) -> list[EquipmentCache]:
    """Overdue, failed, and due within 30 days — sorted by urgency."""

    def sort_key(r: EquipmentCache) -> tuple[int, int, str]:
        days = _days_until(r, today)
        if r.status == "failed":
            return (0, 0, r.tag or r.name or "")
        if r.status == "overdue" or (days is not None and days < 0):
            return (1, days if days is not None else -9999, r.tag or "")
        if days is not None and 0 <= days <= 30:
            return (2, days, r.tag or "")
        return (9, 9999, r.tag or "")

    picked: list[EquipmentCache] = []
    for r in rows:
        days = _days_until(r, today)
        if r.status in ("overdue", "failed"):
            picked.append(r)
        elif days is not None and days < 0:
            picked.append(r)
        elif days is not None and 0 <= days <= 30:
            picked.append(r)
    picked.sort(key=sort_key)
    return picked


def timing_label(row: EquipmentCache, today: date) -> str:
    if row.status == "failed":
        return "Failed spec"
    days = _days_until(row, today)
    if days is None:
        return "-"
    if days < 0:
        return f"{abs(days)} d overdue"
    if days == 0:
        return "due today"
    return f"in {days} d"


def status_display(row: EquipmentCache, today: date) -> str:
    if row.status == "failed":
        return "Failed"
    days = _days_until(row, today)
    if row.status == "overdue" or (days is not None and days < 0):
        return "Overdue"
    if days is not None and 0 <= days <= 30:
        return "Due Soon"
    if row.status == "inactive":
        return "Inactive"
    if row.status == "calibrated":
        return "Calibrated"
    return (row.status or "Unknown").replace("_", " ").title()


def month_bars_from_dates(
    dates: Sequence[date],
    *,
    today: date,
    months: int = 6,
) -> list[MonthBar]:
    # Build last N calendar months ending at today's month
    years_months: list[tuple[int, int]] = []
    y, m = today.year, today.month
    for _ in range(months):
        years_months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    years_months.reverse()
    counts: Counter[tuple[int, int]] = Counter()
    for d in dates:
        counts[(d.year, d.month)] += 1
    bars: list[MonthBar] = []
    for yi, mi in years_months:
        label = date(yi, mi, 1).strftime("%b")
        bars.append(
            MonthBar(
                label=label,
                count=counts.get((yi, mi), 0),
                is_current=(yi == today.year and mi == today.month),
            )
        )
    return bars


def build_compliance_checks(
    stats: dict[str, int],
    *,
    equipment_with_cert: int,
    cal_count_6m: int,
) -> list[CheckRow]:
    active = stats["active"]
    overdue_failed = stats["overdue"] + stats["failed"]
    readiness = stats["readiness"]

    def of_status(attention_if: bool, fail_if: bool = False) -> str:
        if fail_if:
            return "Fail"
        if attention_if:
            return "Attention"
        return "Pass"

    checks = [
        CheckRow(
            check="Overdue / failed gauges",
            result=(
                f"{overdue_failed} gauges need action"
                if overdue_failed
                else "No overdue or failed gauges"
            ),
            status=of_status(overdue_failed > 0, overdue_failed > max(3, active // 10) if active else overdue_failed > 0),
        ),
        CheckRow(
            check="Calibrated coverage (active)",
            result=f"{stats['calibrated']} of {active} active gauges ({readiness}%)",
            status=of_status(readiness < 90, readiness < 75),
        ),
        CheckRow(
            check="Certificate linkage",
            result=(
                f"{equipment_with_cert} of {active} active gauges have a PDF certificate"
                if active
                else "No active equipment"
            ),
            status=of_status(
                active > 0 and equipment_with_cert < active,
                active > 0 and equipment_with_cert == 0,
            )
            if active
            else "Attention",
        ),
        CheckRow(
            check="Calibration activity (last 6 months)",
            result=f"{cal_count_6m} calibrations logged",
            status=of_status(cal_count_6m == 0, False),
        ),
    ]
    return checks


def timezone_abbrev(tz_name: str, when: datetime) -> str:
    try:
        zi = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        zi = ZoneInfo("UTC")
    local = when.astimezone(zi)
    return local.tzname() or tz_name


def allocate_report_id(
    db: Session | None,
    *,
    tenant_id: int | None,
    today: date,
    timezone_name: str,
) -> str:
    """TG-RPT-YYYYMMDD-NNNN using today's org-local date and audit count."""
    ymd = today.strftime("%Y%m%d")
    seq = 1
    if db is not None and tenant_id is not None:
        try:
            zi = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            zi = ZoneInfo("UTC")
        start = datetime.combine(today, time.min, tzinfo=zi)
        end = datetime.combine(today, time.max, tzinfo=zi)
        seq = (
            db.query(AuditEvent)
            .filter(
                AuditEvent.tenant_id == tenant_id,
                AuditEvent.action == "report.downloaded",
                AuditEvent.created_at >= start,
                AuditEvent.created_at <= end,
            )
            .count()
            + 1
        )
    return f"TG-RPT-{ymd}-{seq:04d}"


def build_csv(rows: list[EquipmentCache]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["# Dates are ISO YYYY-MM-DD"])
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
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def _kpi_cards(stats: dict[str, int], report_type: ReportType) -> list[KpiCard]:
    if report_type == "overdue":
        return [
            KpiCard("Overdue", str(stats["overdue"]), "past due", RED),
            KpiCard("Failed", str(stats["failed"]), "action required", MAROON),
            KpiCard("Active", str(stats["active"]), "in register", NAVY),
            KpiCard("Readiness", f"{stats['readiness']}%", "of active", readiness_accent(stats["readiness"])),
        ]
    if report_type == "due":
        return [
            KpiCard("Due soon", str(stats["due_soon"]), "next 30 days", AMBER),
            KpiCard("Overdue", str(stats["overdue"]), "past due", RED),
            KpiCard("Calibrated", str(stats["calibrated"]), f"{stats['readiness']}% of active", GREEN),
            KpiCard("Total", str(stats["total"]), f"{stats['active']} active", NAVY),
        ]
    # inventory + compliance
    return [
        KpiCard("Total equipment", str(stats["total"]), f"{stats['active']} active", NAVY),
        KpiCard("Calibrated", str(stats["calibrated"]), f"{stats['readiness']}% of active", GREEN),
        KpiCard("Due soon", str(stats["due_soon"]), "next 30 days", AMBER),
        KpiCard(
            "Overdue / failed",
            str(stats["overdue"] + stats["failed"]),
            "action required",
            RED,
        ),
        KpiCard("Inactive", str(stats["inactive"]), "excluded from %", SLATE),
    ]


def readiness_accent(pct: int) -> tuple[int, int, int]:
    if pct >= 90:
        return GREEN
    if pct >= 75:
        return AMBER
    return RED


def _meta_fields(
    *,
    org_name: str,
    report_type: ReportType,
    as_of: str,
    generated: str,
    generated_by: str,
    filters: str,
) -> list[MetaField]:
    return [
        MetaField("Organization", org_name),
        MetaField("Report type", REPORT_LABELS.get(report_type, report_type)),
        MetaField("As of", as_of),
        MetaField("Generated", generated),
        MetaField("Generated by", generated_by),
        MetaField("Filters", filters),
    ]


def _equipment_table_rows(
    rows: Sequence[EquipmentCache],
    *,
    today: date,
    date_format: str,
    include_timing: bool,
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for r in rows:
        item = {
            "tag": r.tag or "-",
            "name": r.name or "-",
            "category": r.category or "-",
            "dept": r.department or "-",
            "last": format_date(r.last_calibration, date_format) if r.last_calibration else "-",
            "next": format_date(r.next_calibration, date_format) if r.next_calibration else "-",
            "status": status_display(r, today),
            "location": r.location or "-",
            "serial": r.serial or "-",
        }
        if include_timing:
            item["timing"] = timing_label(r, today)
        out.append(item)
    return out


def build_pdf(
    *,
    tenant_name: str,
    report_type: ReportType,
    rows: list[EquipmentCache],
    all_rows: list[EquipmentCache],
    today: date,
    timezone_name: str = "UTC",
    date_format: str = "DD MMM YYYY",
    time_format: str = "12h",
    extras: ReportExtras | None = None,
) -> bytes:
    extras = extras or ReportExtras()
    now = datetime.now(timezone.utc)
    generated_core = format_datetime(
        now,
        date_format=date_format,
        time_format=time_format,
        tz_name=timezone_name,
    )
    tz_ab = timezone_abbrev(timezone_name, now)
    generated_label = f"{generated_core} {tz_ab}".strip()
    as_of = format_date(today, date_format)
    stats = compliance_stats(all_rows, today)
    label = REPORT_LABELS.get(report_type, report_type)
    report_id = extras.report_id or f"TG-RPT-{today.strftime('%Y%m%d')}-0001"

    role = ROLE_LABELS.get(extras.generated_by_role, extras.generated_by_role or "User")
    by_name = extras.generated_by_name or "User"
    generated_by = f"{by_name} ({role})" if role else by_name

    chrome = ReportChrome(
        org_name=tenant_name or "Workspace",
        report_title=label,
        report_id=report_id,
        generated_label=generated_label,
    )
    pdf = TrueGageReportPDF(chrome)
    pdf.add_page()

    title_map = {
        "compliance": "Compliance Summary Report",
        "inventory": "Full Equipment Inventory",
        "overdue": "Overdue / Failed Equipment",
        "due": "Due Within 30 Days",
    }
    pdf.draw_title_block(
        title_map.get(report_type, label),
        REPORT_DESCRIPTIONS.get(report_type, ""),
    )
    pdf.draw_metadata_grid(
        _meta_fields(
            org_name=tenant_name or "Workspace",
            report_type=report_type,
            as_of=as_of,
            generated=generated_label,
            generated_by=generated_by,
            filters=extras.filters_label,
        )
    )
    pdf.draw_kpi_row(_kpi_cards(stats, report_type))

    if report_type == "compliance":
        pdf.draw_readiness_hero(stats)
        active_ids = {r.id for r in all_rows if r.status != "inactive"}
        with_cert = len(active_ids & extras.certificate_equipment_ids)
        cal_6m = len(extras.calibration_dates)
        pdf.draw_checks_table(
            build_compliance_checks(
                stats,
                equipment_with_cert=with_cert,
                cal_count_6m=cal_6m,
            )
        )
        pdf.draw_category_rates(category_rates(all_rows))
        pdf.draw_month_bars(month_bars_from_dates(extras.calibration_dates, today=today))
        attn = attention_rows(all_rows, today)
        pdf.section_title(
            "Equipment requiring attention",
            "Overdue, failed and due within 30 days. Sorted by urgency.",
        )
        pdf.draw_table(
            [
                TableColumn("tag", "TAG ID", 20, no_wrap=True),
                TableColumn("name", "EQUIPMENT", 34),
                TableColumn("category", "CATEGORY", 24),
                TableColumn("dept", "DEPT.", 18),
                TableColumn("last", "LAST CAL.", 20, no_wrap=True),
                TableColumn("next", "NEXT DUE", 20, no_wrap=True),
                TableColumn("status", "STATUS", 20, align="C"),
                TableColumn("timing", "TIMING", 18),
            ],
            _equipment_table_rows(attn, today=today, date_format=date_format, include_timing=True),
            empty_message="No overdue, failed, or due-soon equipment. Nice work.",
            status_key="status",
        )
        pdf.draw_sign_off_and_closing()

    elif report_type == "inventory":
        pdf.section_title("Equipment register", "All equipment in the workspace.")
        pdf.draw_table(
            [
                TableColumn("tag", "TAG ID", 20, no_wrap=True),
                TableColumn("name", "EQUIPMENT", 36),
                TableColumn("category", "CATEGORY", 24),
                TableColumn("dept", "DEPT.", 22),
                TableColumn("next", "NEXT DUE", 22, no_wrap=True),
                TableColumn("status", "STATUS", 22, align="C"),
                TableColumn("location", "LOCATION", 28),
            ],
            _equipment_table_rows(rows, today=today, date_format=date_format, include_timing=False),
            empty_message="No equipment in this workspace yet.",
            status_key="status",
        )
        pdf.draw_sign_off_and_closing()

    elif report_type == "overdue":
        pdf.section_title(
            "Equipment requiring attention",
            "Overdue and failed equipment. Sorted by urgency.",
        )
        pdf.draw_table(
            [
                TableColumn("tag", "TAG ID", 20, no_wrap=True),
                TableColumn("name", "EQUIPMENT", 34),
                TableColumn("category", "CATEGORY", 24),
                TableColumn("dept", "DEPT.", 18),
                TableColumn("last", "LAST CAL.", 20, no_wrap=True),
                TableColumn("next", "NEXT DUE", 20, no_wrap=True),
                TableColumn("status", "STATUS", 20, align="C"),
                TableColumn("timing", "TIMING", 18),
            ],
            _equipment_table_rows(rows, today=today, date_format=date_format, include_timing=True),
            empty_message="No overdue or failed equipment. Nice work.",
            status_key="status",
        )
        pdf.draw_sign_off_and_closing()

    else:  # due
        sorted_rows = sorted(
            rows,
            key=lambda r: (r.next_calibration or date.max, r.tag or r.name or ""),
        )
        pdf.section_title(
            "Upcoming calibrations",
            "Equipment due within the next 30 days, sorted by next due date.",
        )
        pdf.draw_table(
            [
                TableColumn("tag", "TAG ID", 20, no_wrap=True),
                TableColumn("name", "EQUIPMENT", 34),
                TableColumn("category", "CATEGORY", 24),
                TableColumn("dept", "DEPT.", 18),
                TableColumn("last", "LAST CAL.", 20, no_wrap=True),
                TableColumn("next", "NEXT DUE", 20, no_wrap=True),
                TableColumn("status", "STATUS", 20, align="C"),
                TableColumn("timing", "TIMING", 18),
            ],
            _equipment_table_rows(
                sorted_rows, today=today, date_format=date_format, include_timing=True
            ),
            empty_message="No equipment due within the next 30 days.",
            status_key="status",
        )
        pdf.draw_sign_off_and_closing()

    return output_pdf_bytes(pdf)


def make_report(
    *,
    tenant_name: str,
    tenant_slug: str,
    report_type: ReportType,
    fmt: ReportFormat,
    rows: list[EquipmentCache],
    timezone_name: str = "UTC",
    date_format: str = "DD MMM YYYY",
    time_format: str = "12h",
    extras: ReportExtras | None = None,
    db: Session | None = None,
    tenant_id: int | None = None,
) -> ReportBundle:
    today = local_today(timezone_name)
    filtered = filter_equipment(rows, report_type, today)
    label = REPORT_LABELS.get(report_type, report_type)
    _ = tenant_slug  # retained for call-site compatibility

    extras = extras or ReportExtras()
    if not extras.report_id:
        extras.report_id = allocate_report_id(
            db,
            tenant_id=tenant_id if tenant_id is not None else extras.tenant_id,
            today=today,
            timezone_name=timezone_name,
        )

    if fmt == "csv":
        content = build_csv(filtered)
        filename = f"{extras.report_id}.csv"
        return ReportBundle(
            filename=filename,
            media_type="text/csv; charset=utf-8",
            content=content,
            row_count=len(filtered),
            label=label,
            report_id=extras.report_id,
        )

    content = build_pdf(
        tenant_name=tenant_name,
        report_type=report_type,
        rows=filtered,
        all_rows=rows,
        today=today,
        timezone_name=timezone_name,
        date_format=date_format,
        time_format=time_format,
        extras=extras,
    )
    filename = f"{extras.report_id}.pdf"
    return ReportBundle(
        filename=filename,
        media_type="application/pdf",
        content=content,
        row_count=len(filtered),
        label=label,
        report_id=extras.report_id,
    )


def load_report_extras(db: Session, tenant_id: int, *, today: date) -> ReportExtras:
    """Load certificate coverage and recent calibration dates for PDF enrichment."""
    cert_ids = {
        row[0]
        for row in db.query(Certificate.equipment_id)
        .filter(Certificate.tenant_id == tenant_id)
        .distinct()
        .all()
        if row[0] is not None
    }
    # last 6 months of calibration activity
    y, m = today.year, today.month
    for _ in range(5):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    start = date(y, m, 1)
    cal_dates = [
        row[0]
        for row in db.query(CalibrationRecord.performed_on)
        .filter(
            CalibrationRecord.tenant_id == tenant_id,
            CalibrationRecord.performed_on >= start,
            CalibrationRecord.performed_on <= today,
        )
        .all()
        if row[0] is not None
    ]
    return ReportExtras(
        certificate_equipment_ids=cert_ids,
        calibration_dates=cal_dates,
        tenant_id=tenant_id,
    )
