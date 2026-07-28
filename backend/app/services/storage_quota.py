"""Tenant certificate vault access + quota helpers."""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.config import Settings, get_settings
from app.models import Certificate, Tenant


def tenant_storage_usage(db: Session, tenant_id: int) -> int:
    total = (
        db.query(func.coalesce(func.sum(Certificate.size_bytes), 0))
        .filter(Certificate.tenant_id == tenant_id, Certificate.status == "ready")
        .scalar()
    )
    return int(total or 0)


def tenant_certificate_count(db: Session, tenant_id: int) -> int:
    return (
        db.query(Certificate)
        .filter(Certificate.tenant_id == tenant_id, Certificate.status == "ready")
        .count()
    )


def require_tenant_storage(tenant: Tenant | None) -> Tenant:
    if tenant is None:
        raise HTTPException(status_code=404, detail="Company not found")
    if not bool(getattr(tenant, "storage_enabled", False)):
        raise HTTPException(
            status_code=403,
            detail="Certificate vault is not included in your plan. Contact TrueGage to enable document storage.",
        )
    return tenant


def assert_storage_quota(
    db: Session,
    *,
    tenant_id: int,
    additional_bytes: int,
    settings: Settings | None = None,
) -> None:
    cfg = settings or get_settings()
    quota = int(cfg.certificate_tenant_quota_bytes)
    used = tenant_storage_usage(db, tenant_id)
    if used + max(0, int(additional_bytes)) > quota:
        raise HTTPException(
            status_code=400,
            detail="Company storage quota exceeded (2 GB). Delete unused certificates or contact TrueGage.",
        )


def storage_fields_for_tenant(db: Session, tenant: Tenant | None) -> dict:
    cfg = get_settings()
    enabled = bool(tenant and getattr(tenant, "storage_enabled", False))
    used = tenant_storage_usage(db, tenant.id) if tenant else 0
    return {
        "storage_enabled": enabled,
        "storage_used_bytes": used if enabled else 0,
        "storage_quota_bytes": int(cfg.certificate_tenant_quota_bytes) if enabled else 0,
    }
