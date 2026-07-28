"""Tenant workspace audit event helpers."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AuditEvent, User, new_audit_id


def actor_display_name(user: User | None) -> str:
    if user is None:
        return "System"
    name = (user.full_name or "").strip()
    if name:
        return name
    return (user.email or "").strip() or "User"


def record_audit_event(
    db: Session,
    *,
    tenant_id: int,
    user: User | None,
    action: str,
    target_type: str = "",
    target_id: str | None = None,
    target_name: str = "",
    detail: str = "",
) -> AuditEvent:
    row = AuditEvent(
        tenant_id=tenant_id,
        public_id=new_audit_id(),
        user_id=user.id if user is not None else None,
        user_name=actor_display_name(user)[:255],
        action=action[:64],
        target_type=(target_type or "")[:64],
        target_id=(target_id or None),
        target_name=(target_name or "")[:255],
        detail=(detail or "")[:512],
    )
    db.add(row)
    return row
