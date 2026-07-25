"""Sync due-date alerts into the persisted notifications inbox."""

from __future__ import annotations

from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import AppNotification, EquipmentCache, new_notification_id
from app.services.equipment_sync import refresh_equipment_statuses


def sync_due_date_notifications(db: Session, tenant_id: int) -> list[AppNotification]:
    """Upsert overdue / due-soon (<=3d) alerts; leave email/system rows alone."""
    eq_rows = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == tenant_id).all()
    refresh_equipment_statuses(db, eq_rows)
    today = date.today()
    rows = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id == tenant_id, EquipmentCache.status != "inactive")
        .all()
    )

    active_keys: set[str] = set()
    for eq in rows:
        if eq.next_calibration is None:
            continue
        days = (eq.next_calibration - today).days
        if eq.status == "failed" or days < 0:
            key = f"overdue-{eq.public_id}"
            title = "Calibration Overdue"
            body = (
                f"{eq.name} ({eq.tag}) next calibration date was "
                f"{eq.next_calibration.isoformat()} and is now overdue."
            )
            event_date = eq.next_calibration.isoformat()
        elif days <= 3:
            key = f"due-{eq.public_id}"
            title = f"Calibration Due in {days} Day{'s' if days != 1 else ''}"
            body = (
                f"{eq.name} ({eq.tag}) is scheduled for calibration on "
                f"{eq.next_calibration.isoformat()}."
            )
            event_date = today.isoformat()
        else:
            continue

        active_keys.add(key)
        existing = (
            db.query(AppNotification)
            .filter(AppNotification.tenant_id == tenant_id, AppNotification.source_key == key)
            .one_or_none()
        )
        if existing is None:
            db.add(
                AppNotification(
                    tenant_id=tenant_id,
                    public_id=new_notification_id(),
                    source_key=key,
                    type="reminder",
                    title=title,
                    body=body,
                    event_date=event_date,
                    read=False,
                    equipment_public_id=eq.public_id,
                )
            )
        else:
            existing.title = title
            existing.body = body
            existing.event_date = event_date
            existing.equipment_public_id = eq.public_id
            existing.type = "reminder"

    # Drop stale due-date reminders that no longer apply
    stale = (
        db.query(AppNotification)
        .filter(
            AppNotification.tenant_id == tenant_id,
            or_(
                AppNotification.source_key.like("overdue-%"),
                AppNotification.source_key.like("due-%"),
            ),
        )
        .all()
    )
    for row in stale:
        if row.source_key not in active_keys:
            db.delete(row)

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
        existing.read = False
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
