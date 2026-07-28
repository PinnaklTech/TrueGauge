"""Tenant-local reminder scheduler: claim jobs, expand windows, ledger, deliver."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    AppSettings,
    EquipmentCache,
    NotificationRecipient,
    ReminderDispatch,
    ReminderJob,
    Tenant,
    User,
)
from app.services.email_service import (
    EmailError,
    OverdueEquipmentRow,
    ReminderEquipmentRow,
    load_smtp_config,
    send_due_reminder_email,
    send_overdue_alert_email,
    send_weekly_digest_email,
    smtp_configured,
)
from app.services.equipment_sync import refresh_equipment_statuses
from app.services.notifications import sync_due_date_notifications

logger = logging.getLogger("truegauge.reminders")

JOB_DAILY = "daily"
JOB_WEEKLY = "weekly_digest"
CHANNEL_EMAIL = "email"
CHANNEL_IN_APP = "in_app"
FAILED_BACKOFF = timedelta(minutes=15)
MAX_ATTEMPTS = 5

# Exact day offsets for due-soon windows (0 maps into the 1-day window)
DUE_WINDOWS: list[tuple[str, int, str]] = [
    ("remind_30d", 30, "due_30"),
    ("remind_14d", 14, "due_14"),
    ("remind_7d", 7, "due_7"),
    ("remind_1d", 1, "due_1"),
]


@dataclass
class EmailRecipient:
    key: str
    email: str
    name: str
    timezone: str = "UTC"


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo((name or "UTC").strip() or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def tenant_local_now(settings_row: AppSettings) -> datetime:
    return datetime.now(_tz(settings_row.timezone))


def tenant_local_today(settings_row: AppSettings) -> date:
    return tenant_local_now(settings_row).date()


def reminder_rules_from_settings(row: AppSettings) -> dict:
    return {
        "remind_30d": bool(row.remind_30d),
        "remind_14d": bool(row.remind_14d),
        "remind_7d": bool(row.remind_7d),
        "remind_1d": bool(row.remind_1d),
        "remind_overdue_daily": bool(row.remind_overdue_daily),
        "remind_weekly_digest": bool(row.remind_weekly_digest),
        "reminder_hour_local": int(row.reminder_hour_local or 8),
    }


def last_daily_run_at(db: Session, tenant_id: int) -> Optional[datetime]:
    row = (
        db.query(ReminderJob)
        .filter(
            ReminderJob.tenant_id == tenant_id,
            ReminderJob.job_kind == JOB_DAILY,
            ReminderJob.status == "done",
        )
        .order_by(ReminderJob.finished_at.desc().nullslast(), ReminderJob.id.desc())
        .first()
    )
    return row.finished_at if row else None


def ensure_jobs_for_tenant(
    db: Session,
    *,
    tenant_id: int,
    settings_row: AppSettings,
    local_today: date,
) -> None:
    """Create today's pending job rows if missing."""
    existing = {
        (j.job_kind, j.job_date_local)
        for j in db.query(ReminderJob)
        .filter(ReminderJob.tenant_id == tenant_id, ReminderJob.job_date_local == local_today)
        .all()
    }
    if (JOB_DAILY, local_today) not in existing:
        db.add(
            ReminderJob(
                tenant_id=tenant_id,
                job_kind=JOB_DAILY,
                job_date_local=local_today,
                status="pending",
            )
        )
    if settings_row.remind_weekly_digest and local_today.weekday() == 0:
        if (JOB_WEEKLY, local_today) not in existing:
            db.add(
                ReminderJob(
                    tenant_id=tenant_id,
                    job_kind=JOB_WEEKLY,
                    job_date_local=local_today,
                    status="pending",
                )
            )
    db.flush()


def _requeue_stale_failed(db: Session, now_utc: datetime) -> None:
    cutoff = now_utc - FAILED_BACKOFF
    rows = (
        db.query(ReminderJob)
        .filter(ReminderJob.status == "failed", ReminderJob.attempts < MAX_ATTEMPTS)
        .all()
    )
    for job in rows:
        finished = job.finished_at
        if finished is None or finished <= cutoff:
            job.status = "pending"
            job.error = None
            job.locked_at = None


def claim_due_jobs(db: Session, now_utc: datetime) -> list[ReminderJob]:
    """Claim pending jobs whose tenant local hour has reached reminder_hour_local."""
    _requeue_stale_failed(db, now_utc)
    db.flush()

    tenants = db.query(Tenant).filter(Tenant.active.is_(True)).all()
    claimed: list[ReminderJob] = []
    for tenant in tenants:
        settings_row = (
            db.query(AppSettings).filter(AppSettings.tenant_id == tenant.id).one_or_none()
        )
        if settings_row is None:
            continue
        local = tenant_local_now(settings_row)
        local_today = local.date()
        hour = int(settings_row.reminder_hour_local or 8)
        ensure_jobs_for_tenant(
            db, tenant_id=tenant.id, settings_row=settings_row, local_today=local_today
        )
        if local.hour < hour:
            continue

        stmt = (
            select(ReminderJob)
            .where(
                ReminderJob.tenant_id == tenant.id,
                ReminderJob.status == "pending",
                ReminderJob.job_date_local <= local_today,
            )
            .with_for_update(skip_locked=True)
        )
        for job in db.execute(stmt).scalars().all():
            job.status = "running"
            job.locked_at = now_utc
            job.started_at = now_utc
            job.attempts = int(job.attempts or 0) + 1
            claimed.append(job)
    db.flush()
    return claimed


def _active_equipment(db: Session, tenant_id: int, today: date) -> list[EquipmentCache]:
    rows = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id == tenant_id, EquipmentCache.status != "inactive")
        .all()
    )
    refresh_equipment_statuses(db, rows, today=today, commit=False)
    return (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id == tenant_id, EquipmentCache.status != "inactive")
        .all()
    )


def _days_until(eq: EquipmentCache, today: date) -> Optional[int]:
    if eq.next_calibration is None:
        return None
    return (eq.next_calibration - today).days


def _email_recipients(db: Session, tenant_id: int) -> list[EmailRecipient]:
    out: list[EmailRecipient] = []
    seen: set[str] = set()
    users = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.active.is_(True), User.notify_email.is_(True))
        .all()
    )
    for u in users:
        email = (u.email or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        out.append(
            EmailRecipient(
                key=f"user:{u.id}",
                email=email,
                name=u.full_name or "",
                timezone=u.timezone or "UTC",
            )
        )
    recipients = (
        db.query(NotificationRecipient)
        .filter(
            NotificationRecipient.tenant_id == tenant_id,
            NotificationRecipient.active.is_(True),
        )
        .all()
    )
    for r in recipients:
        email = (r.email or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        out.append(
            EmailRecipient(
                key=f"recipient:{r.id}",
                email=email,
                name=r.name or "",
            )
        )
    return out


def _try_claim_dispatch(
    db: Session,
    *,
    tenant_id: int,
    kind: str,
    period_key: str,
    recipient_key: str,
    channel: str,
    equipment_public_id: Optional[str] = None,
) -> Optional[ReminderDispatch]:
    """Insert ledger row; return it if this process owns the send, else None."""
    existing = (
        db.query(ReminderDispatch)
        .filter(
            ReminderDispatch.tenant_id == tenant_id,
            ReminderDispatch.kind == kind,
            ReminderDispatch.period_key == period_key,
            ReminderDispatch.recipient_key == recipient_key,
            ReminderDispatch.channel == channel,
        )
        .one_or_none()
    )
    if existing is not None:
        if existing.status == "failed":
            existing.status = "pending"
            existing.error = None
            existing.sent_at = None
            db.flush()
            return existing
        return None

    row = ReminderDispatch(
        tenant_id=tenant_id,
        kind=kind,
        period_key=period_key,
        recipient_key=recipient_key,
        channel=channel,
        status="pending",
        equipment_public_id=equipment_public_id,
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
        return row
    except IntegrityError:
        return None


def _mark_dispatch_sent(row: ReminderDispatch, now_utc: datetime) -> None:
    row.status = "sent"
    row.sent_at = now_utc
    row.error = None


def _mark_dispatch_failed(row: ReminderDispatch, err: str) -> None:
    row.status = "failed"
    row.error = (err or "")[:2000]


def _row_from_eq(eq: EquipmentCache, today: date, *, overdue: bool) -> ReminderEquipmentRow | OverdueEquipmentRow:
    days = _days_until(eq, today) or 0
    if overdue:
        return OverdueEquipmentRow(
            name=eq.name or "Unnamed equipment",
            tag=eq.tag or eq.public_id,
            due_date=eq.next_calibration.isoformat() if eq.next_calibration else "",
            days_overdue=abs(min(days, 0)),
        )
    return ReminderEquipmentRow(
        name=eq.name or "Unnamed equipment",
        tag=eq.tag or eq.public_id,
        due_date=eq.next_calibration.isoformat() if eq.next_calibration else "",
        days_until=max(days, 0),
    )


def _process_daily(
    db: Session,
    *,
    job: ReminderJob,
    settings_row: AppSettings,
    local_today: date,
    now_utc: datetime,
) -> bool:
    """Returns True if all attempted deliveries succeeded (or none attempted)."""
    ok = True
    rules = reminder_rules_from_settings(settings_row)
    equipment = _active_equipment(db, job.tenant_id, local_today)

    # In-app inbox (shared rows); respect notify prefs indirectly via sync + user reads
    sync_due_date_notifications(
        db,
        job.tenant_id,
        today=local_today,
        rules=rules,
        commit=False,
    )

    # Ledger mark for in-app so we don't thrash title updates as "new sends"
    for eq in equipment:
        days = _days_until(eq, local_today)
        if days is None:
            continue
        kind: Optional[str] = None
        period_key: Optional[str] = None
        if days < 0 and rules["remind_overdue_daily"]:
            kind = "overdue_daily"
            period_key = f"{eq.public_id}:{local_today.isoformat()}"
        elif days in (0, 1) and rules["remind_1d"]:
            kind = "due_1"
            period_key = f"{eq.public_id}:{(eq.next_calibration or local_today).isoformat()}"
        else:
            for flag, offset, kind_name in DUE_WINDOWS:
                if offset == 1:
                    continue
                if days == offset and rules[flag]:
                    kind = kind_name
                    period_key = f"{eq.public_id}:{(eq.next_calibration or local_today).isoformat()}"
                    break
        if not kind or not period_key:
            continue
        disp = _try_claim_dispatch(
            db,
            tenant_id=job.tenant_id,
            kind=kind,
            period_key=period_key,
            recipient_key="in_app",
            channel=CHANNEL_IN_APP,
            equipment_public_id=eq.public_id,
        )
        if disp is not None:
            _mark_dispatch_sent(disp, now_utc)

    if not smtp_configured(settings_row):
        return ok

    try:
        config = load_smtp_config(settings_row)
    except EmailError as exc:
        logger.warning("reminder smtp load failed tenant=%s: %s", job.tenant_id, exc)
        return ok

    app_settings = get_settings()
    tenant = db.get(Tenant, job.tenant_id)
    cta = app_settings.workspace_equipment_url(
        tenant.slug if tenant else "",
        status="overdue",
    )
    recipients = _email_recipients(db, job.tenant_id)

    # Group equipment by window kind
    by_kind: dict[str, list[EquipmentCache]] = {k: [] for _, _, k in DUE_WINDOWS}
    by_kind["overdue_daily"] = []
    for eq in equipment:
        days = _days_until(eq, local_today)
        if days is None:
            continue
        if days < 0 and rules["remind_overdue_daily"]:
            by_kind["overdue_daily"].append(eq)
        elif days in (0, 1) and rules["remind_1d"]:
            by_kind["due_1"].append(eq)
        else:
            for flag, offset, kind_name in DUE_WINDOWS:
                if offset == 1:
                    continue
                if days == offset and rules[flag]:
                    by_kind[kind_name].append(eq)
                    break

    window_labels = {
        "due_30": "30 days",
        "due_14": "14 days",
        "due_7": "7 days",
        "due_1": "1 day / due today",
    }

    for recipient in recipients:
        # Overdue batch
        overdue_eq = by_kind["overdue_daily"]
        if overdue_eq:
            claimed_rows: list[ReminderDispatch] = []
            items: list[OverdueEquipmentRow] = []
            for eq in overdue_eq:
                period_key = f"{eq.public_id}:{local_today.isoformat()}"
                disp = _try_claim_dispatch(
                    db,
                    tenant_id=job.tenant_id,
                    kind="overdue_daily",
                    period_key=period_key,
                    recipient_key=recipient.key,
                    channel=CHANNEL_EMAIL,
                    equipment_public_id=eq.public_id,
                )
                if disp is not None:
                    claimed_rows.append(disp)
                    items.append(_row_from_eq(eq, local_today, overdue=True))  # type: ignore[arg-type]
            if items:
                try:
                    send_overdue_alert_email(
                        config,
                        to_email=recipient.email,
                        to_name=recipient.name,
                        items=items,  # type: ignore[arg-type]
                        cta_url=cta,
                    )
                    for d in claimed_rows:
                        _mark_dispatch_sent(d, now_utc)
                except Exception as exc:  # noqa: BLE001
                    err = str(exc)
                    ok = False
                    logger.warning(
                        "overdue email failed tenant=%s to=%s: %s",
                        job.tenant_id,
                        recipient.email,
                        err,
                    )
                    for d in claimed_rows:
                        _mark_dispatch_failed(d, err)

        for kind_name, label in window_labels.items():
            eqs = by_kind.get(kind_name) or []
            if not eqs:
                continue
            claimed_rows = []
            items_due: list[ReminderEquipmentRow] = []
            for eq in eqs:
                next_iso = (eq.next_calibration or local_today).isoformat()
                period_key = f"{eq.public_id}:{next_iso}"
                disp = _try_claim_dispatch(
                    db,
                    tenant_id=job.tenant_id,
                    kind=kind_name,
                    period_key=period_key,
                    recipient_key=recipient.key,
                    channel=CHANNEL_EMAIL,
                    equipment_public_id=eq.public_id,
                )
                if disp is not None:
                    claimed_rows.append(disp)
                    items_due.append(_row_from_eq(eq, local_today, overdue=False))  # type: ignore[arg-type]
            if items_due:
                try:
                    send_due_reminder_email(
                        config,
                        to_email=recipient.email,
                        to_name=recipient.name,
                        window_label=label,
                        items=items_due,
                        cta_url=cta,
                    )
                    for d in claimed_rows:
                        _mark_dispatch_sent(d, now_utc)
                except Exception as exc:  # noqa: BLE001
                    err = str(exc)
                    ok = False
                    logger.warning(
                        "due email failed tenant=%s kind=%s to=%s: %s",
                        job.tenant_id,
                        kind_name,
                        recipient.email,
                        err,
                    )
                    for d in claimed_rows:
                        _mark_dispatch_failed(d, err)
    return ok


def _process_weekly(
    db: Session,
    *,
    job: ReminderJob,
    settings_row: AppSettings,
    local_today: date,
    now_utc: datetime,
) -> bool:
    ok = True
    if not settings_row.remind_weekly_digest:
        return ok
    iso = local_today.isocalendar()
    week_key = f"{iso.year}-W{iso.week:02d}"
    equipment = _active_equipment(db, job.tenant_id, local_today)
    upcoming: list[ReminderEquipmentRow] = []
    for eq in equipment:
        days = _days_until(eq, local_today)
        if days is None:
            continue
        if 7 <= days <= 30:
            upcoming.append(_row_from_eq(eq, local_today, overdue=False))  # type: ignore[arg-type]
    upcoming.sort(key=lambda r: (r.days_until, r.name.lower()))

    # Shared in-app digest notification
    from app.services.notifications import upsert_notification

    upsert_notification(
        db,
        tenant_id=job.tenant_id,
        source_key=f"weekly-digest-{week_key}",
        title="Weekly calibration digest",
        body=(
            f"{len(upcoming)} item{'s' if len(upcoming) != 1 else ''} due in the next 7–30 days."
            if upcoming
            else "No calibrations due in the next 7–30 days."
        ),
        type_="reminder",
        event_date=local_today.isoformat(),
        commit=False,
    )

    if not smtp_configured(settings_row) or not upcoming:
        return ok

    try:
        config = load_smtp_config(settings_row)
    except EmailError as exc:
        logger.warning("weekly digest smtp failed tenant=%s: %s", job.tenant_id, exc)
        return ok

    tenant = db.get(Tenant, job.tenant_id)
    cta = get_settings().workspace_equipment_url(
        tenant.slug if tenant else "",
        status="overdue",
    )
    for recipient in _email_recipients(db, job.tenant_id):
        period_key = f"{week_key}:{recipient.key}"
        disp = _try_claim_dispatch(
            db,
            tenant_id=job.tenant_id,
            kind="weekly_digest",
            period_key=period_key,
            recipient_key=recipient.key,
            channel=CHANNEL_EMAIL,
        )
        if disp is None:
            continue
        try:
            send_weekly_digest_email(
                config,
                to_email=recipient.email,
                to_name=recipient.name,
                week_label=week_key,
                items=upcoming,
                cta_url=cta,
            )
            _mark_dispatch_sent(disp, now_utc)
        except Exception as exc:  # noqa: BLE001
            ok = False
            _mark_dispatch_failed(disp, str(exc))
    return ok


def process_job(db: Session, job: ReminderJob) -> None:
    now_utc = datetime.now(timezone.utc)
    settings_row = (
        db.query(AppSettings).filter(AppSettings.tenant_id == job.tenant_id).one_or_none()
    )
    if settings_row is None:
        job.status = "failed"
        job.error = "Missing settings"
        job.finished_at = now_utc
        return
    local_today = tenant_local_today(settings_row)
    try:
        if job.job_kind == JOB_DAILY:
            ok = _process_daily(
                db,
                job=job,
                settings_row=settings_row,
                local_today=local_today,
                now_utc=now_utc,
            )
        elif job.job_kind == JOB_WEEKLY:
            ok = _process_weekly(
                db,
                job=job,
                settings_row=settings_row,
                local_today=local_today,
                now_utc=now_utc,
            )
        else:
            raise ValueError(f"Unknown job kind: {job.job_kind}")
        if ok:
            job.status = "done"
            job.error = None
        else:
            job.status = "failed"
            job.error = "One or more email deliveries failed"
        job.finished_at = now_utc
    except Exception as exc:  # noqa: BLE001
        logger.exception("reminder job failed id=%s tenant=%s", job.id, job.tenant_id)
        job.status = "failed"
        job.error = str(exc)[:2000]
        job.finished_at = now_utc


def run_reminder_tick(db: Session) -> dict:
    """One scheduler tick: ensure jobs, claim, process. Safe under multi-worker."""
    now_utc = datetime.now(timezone.utc)
    claimed = claim_due_jobs(db, now_utc)
    db.commit()
    processed = 0
    for job in claimed:
        # Re-load in this session after commit
        fresh = db.get(ReminderJob, job.id)
        if fresh is None or fresh.status != "running":
            continue
        process_job(db, fresh)
        processed += 1
        db.commit()
    return {"jobs_processed": processed, "ok": True}
