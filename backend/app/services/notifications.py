"""Sync due-date alerts into the persisted notifications inbox."""

from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import AppNotification, AppSettings, EquipmentCache, NotificationRead, new_notification_id
from app.services.equipment_sync import refresh_equipment_statuses

DEFAULT_RULES = {
    "remind_30d": False,
    "remind_14d": False,
    "remind_7d": False,
    "remind_1d": False,
    "remind_overdue_daily": False,
}


def _rules_from_settings(row: Optional[AppSettings]) -> dict:
    if row is None:
        return dict(DEFAULT_RULES)
    return {
        "remind_30d": bool(row.remind_30d),
        "remind_14d": bool(row.remind_14d),
        "remind_7d": bool(row.remind_7d),
        "remind_1d": bool(row.remind_1d),
        "remind_overdue_daily": bool(row.remind_overdue_daily),
    }


def upsert_notification(
    db: Session,
    *,
    tenant_id: int,
    source_key: str,
    title: str,
    body: str,
    type_: str = "reminder",
    event_date: Optional[str] = None,
    equipment_public_id: Optional[str] = None,
    commit: bool = True,
) -> AppNotification:
    existing = (
        db.query(AppNotification)
        .filter(AppNotification.tenant_id == tenant_id, AppNotification.source_key == source_key)
        .one_or_none()
    )
    if existing is None:
        row = AppNotification(
            tenant_id=tenant_id,
            public_id=new_notification_id(),
            source_key=source_key,
            type=type_,
            title=title,
            body=body,
            event_date=event_date or date.today().isoformat(),
            read=False,
            equipment_public_id=equipment_public_id,
        )
        db.add(row)
        if commit:
            db.commit()
            db.refresh(row)
        return row
    existing.title = title
    existing.body = body
    existing.type = type_
    if event_date is not None:
        existing.event_date = event_date
    if equipment_public_id is not None:
        existing.equipment_public_id = equipment_public_id
    if commit:
        db.commit()
        db.refresh(existing)
    return existing


def sync_due_date_notifications(
    db: Session,
    tenant_id: int,
    *,
    today: Optional[date] = None,
    rules: Optional[dict] = None,
    commit: bool = True,
) -> list[AppNotification]:
    """Upsert overdue + 30/14/7/1-day (incl. due-today) alerts per reminder rules."""
    as_of = today or date.today()
    settings_row = db.query(AppSettings).filter(AppSettings.tenant_id == tenant_id).one_or_none()
    active_rules = rules if rules is not None else _rules_from_settings(settings_row)

    eq_rows = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == tenant_id).all()
    refresh_equipment_statuses(db, eq_rows, today=as_of, commit=False)
    rows = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id == tenant_id, EquipmentCache.status != "inactive")
        .all()
    )

    active_keys: set[str] = set()
    for eq in rows:
        if eq.next_calibration is None:
            continue
        days = (eq.next_calibration - as_of).days
        key: Optional[str] = None
        title = ""
        body = ""
        event_date = ""

        if eq.status == "failed" or days < 0:
            if not active_rules.get("remind_overdue_daily", False):
                continue
            key = f"overdue-{eq.public_id}"
            title = "Calibration Overdue"
            body = (
                f"{eq.name} ({eq.tag}) next calibration date was "
                f"{eq.next_calibration.isoformat()} and is now overdue."
            )
            event_date = eq.next_calibration.isoformat()
        elif days in (0, 1) and active_rules.get("remind_1d", False):
            key = f"due1-{eq.public_id}"
            label = "today" if days == 0 else "tomorrow"
            title = f"Calibration Due {label.capitalize()}"
            body = (
                f"{eq.name} ({eq.tag}) is scheduled for calibration on "
                f"{eq.next_calibration.isoformat()}."
            )
            event_date = as_of.isoformat()
        elif days == 7 and active_rules.get("remind_7d", False):
            key = f"due7-{eq.public_id}"
            title = "Calibration Due in 7 Days"
            body = (
                f"{eq.name} ({eq.tag}) is scheduled for calibration on "
                f"{eq.next_calibration.isoformat()}."
            )
            event_date = as_of.isoformat()
        elif days == 14 and active_rules.get("remind_14d", False):
            key = f"due14-{eq.public_id}"
            title = "Calibration Due in 14 Days"
            body = (
                f"{eq.name} ({eq.tag}) is scheduled for calibration on "
                f"{eq.next_calibration.isoformat()}."
            )
            event_date = as_of.isoformat()
        elif days == 30 and active_rules.get("remind_30d", False):
            key = f"due30-{eq.public_id}"
            title = "Calibration Due in 30 Days"
            body = (
                f"{eq.name} ({eq.tag}) is scheduled for calibration on "
                f"{eq.next_calibration.isoformat()}."
            )
            event_date = as_of.isoformat()
        else:
            continue

        active_keys.add(key)
        upsert_notification(
            db,
            tenant_id=tenant_id,
            source_key=key,
            title=title,
            body=body,
            type_="reminder",
            event_date=event_date,
            equipment_public_id=eq.public_id,
            commit=False,
        )

    # Drop stale due-date reminders that no longer apply (incl. legacy due- keys)
    stale = (
        db.query(AppNotification)
        .filter(
            AppNotification.tenant_id == tenant_id,
            or_(
                AppNotification.source_key.like("overdue-%"),
                AppNotification.source_key.like("due-%"),
                AppNotification.source_key.like("due1-%"),
                AppNotification.source_key.like("due7-%"),
                AppNotification.source_key.like("due14-%"),
                AppNotification.source_key.like("due30-%"),
            ),
        )
        .all()
    )
    for row in stale:
        if row.source_key not in active_keys:
            db.delete(row)

    if commit:
        db.commit()
    return (
        db.query(AppNotification)
        .filter(AppNotification.tenant_id == tenant_id)
        .order_by(AppNotification.created_at.desc(), AppNotification.id.desc())
        .all()
    )


def add_system_notification(
    db: Session,
    *,
    tenant_id: int,
    source_key: str,
    title: str,
    body: str,
    type_: str = "system",
) -> AppNotification:
    existing = (
        db.query(AppNotification)
        .filter(AppNotification.tenant_id == tenant_id, AppNotification.source_key == source_key)
        .one_or_none()
    )
    if existing is not None:
        existing.title = title
        existing.body = body
        existing.type = type_
        # Re-alert every user by clearing their personal read markers
        db.query(NotificationRead).filter(NotificationRead.notification_id == existing.id).delete(
            synchronize_session=False
        )
        db.commit()
        db.refresh(existing)
        return existing
    row = AppNotification(
        tenant_id=tenant_id,
        public_id=new_notification_id(),
        source_key=source_key,
        type=type_,
        title=title,
        body=body,
        event_date=date.today().isoformat(),
        read=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
