"""Persist and prune generated PDF reports (last N per tenant)."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import GeneratedReport

KEEP_LAST = 3


def save_generated_report(
    db: Session,
    *,
    tenant_id: int,
    report_id: str,
    report_type: str,
    filename: str,
    content: bytes,
    row_count: int,
    generated_by_user_id: int | None,
    generated_by_name: str,
    generated_by_role: str,
    meta: dict[str, Any] | None = None,
) -> GeneratedReport:
    row = GeneratedReport(
        tenant_id=tenant_id,
        report_id=report_id[:64],
        report_type=(report_type or "compliance")[:32],
        filename=(filename or f"{report_id}.pdf")[:128],
        generated_by_user_id=generated_by_user_id,
        generated_by_name=(generated_by_name or "")[:255],
        generated_by_role=(generated_by_role or "")[:64],
        row_count=int(row_count or 0),
        content=content,
        meta_json=json.dumps(meta) if meta else None,
    )
    db.add(row)
    db.flush()
    prune_old_reports(db, tenant_id=tenant_id, keep=KEEP_LAST)
    return row


def prune_old_reports(db: Session, *, tenant_id: int, keep: int = KEEP_LAST) -> int:
    """Delete oldest reports beyond `keep` newest for the tenant. Returns deleted count."""
    rows = (
        db.query(GeneratedReport)
        .filter(GeneratedReport.tenant_id == tenant_id)
        .order_by(GeneratedReport.created_at.desc(), GeneratedReport.id.desc())
        .all()
    )
    overflow = rows[keep:]
    for old in overflow:
        db.delete(old)
    if overflow:
        db.flush()
    return len(overflow)


def list_reports(db: Session, *, tenant_id: int, limit: int = KEEP_LAST) -> list[GeneratedReport]:
    return (
        db.query(GeneratedReport)
        .filter(GeneratedReport.tenant_id == tenant_id)
        .order_by(GeneratedReport.created_at.desc(), GeneratedReport.id.desc())
        .limit(limit)
        .all()
    )


def get_report(db: Session, *, tenant_id: int, report_pk: int) -> GeneratedReport | None:
    return (
        db.query(GeneratedReport)
        .filter(GeneratedReport.tenant_id == tenant_id, GeneratedReport.id == report_pk)
        .first()
    )
