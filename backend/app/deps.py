"""Auth dependency helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TenantMembership, User
from app.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)

PLATFORM_ADMIN = "platform_admin"
ORG_ADMIN = "admin"


@dataclass
class TenantContext:
    user: User
    tenant_id: int


def _load_user_from_creds(
    creds: Optional[HTTPAuthorizationCredentials],
    db: Session,
) -> tuple[User, dict]:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Sign in required")
    payload = decode_access_token(creds.credentials)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid — please sign in again")
    user_id = payload.get("sub")
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid session") from None
    user = db.get(User, uid)
    if user is None or not user.active:
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    return user, payload


def user_can_access_tenant(db: Session, user: User, tenant_id: int) -> bool:
    if user.role == PLATFORM_ADMIN:
        return (
            db.query(TenantMembership)
            .filter(TenantMembership.user_id == user.id, TenantMembership.tenant_id == tenant_id)
            .first()
            is not None
        )
    return user.tenant_id is not None and int(user.tenant_id) == int(tenant_id)


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    user, _payload = _load_user_from_creds(creds, db)
    return user


def get_tenant_context(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> TenantContext:
    user, payload = _load_user_from_creds(creds, db)
    raw_tid = payload.get("tenant_id")
    try:
        tenant_id = int(raw_tid)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Session missing workspace — please sign in again") from None
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=403, detail="You do not have access to this workspace")
    return TenantContext(user=user, tenant_id=tenant_id)


def require_admin(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
    """Org admin or platform admin acting in the active tenant."""
    if ctx.user.role not in (ORG_ADMIN, PLATFORM_ADMIN):
        raise HTTPException(status_code=403, detail="Admin access required")
    return ctx


def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != PLATFORM_ADMIN:
        raise HTTPException(status_code=403, detail="TrueGage platform admin access required")
    return user


def get_optional_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if creds is None or not creds.credentials:
        return None
    payload = decode_access_token(creds.credentials)
    if payload is None:
        return None
    try:
        uid = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    user = db.get(User, uid)
    if user is None or not user.active:
        return None
    return user


def is_org_admin_role(role: str) -> bool:
    return role in (ORG_ADMIN, PLATFORM_ADMIN)
