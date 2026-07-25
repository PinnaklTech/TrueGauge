"""Auth, org profile, tenants, notifications inbox, email audit history."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import (
    PLATFORM_ADMIN,
    TenantContext,
    get_current_user,
    get_tenant_context,
    is_org_admin_role,
    require_admin,
    require_platform_admin,
    user_can_access_tenant,
)
from app.models import (
    AppNotification,
    AppSettings,
    EmailAuditLog,
    EquipmentCache,
    Tenant,
    TenantMembership,
    User,
)
from app.schemas import (
    AdminUserCreateIn,
    AdminUserUpdateIn,
    AppNotificationListOut,
    AppNotificationOut,
    AuthTokenOut,
    EmailAuditListOut,
    EmailAuditOut,
    LoginIn,
    MeOut,
    OrgProfileIn,
    OrgProfileOut,
    PlatformOverviewOut,
    RegisterIn,
    TenantCreateIn,
    TenantDetailOut,
    TenantListOut,
    TenantOut,
    TenantUpdateIn,
    UserListOut,
    UserOut,
    UserUpdateIn,
)
from app.security import create_access_token, hash_password, verify_password
from app.services.notifications import add_system_notification, sync_due_date_notifications

router = APIRouter()


def get_or_create_settings(db: Session, tenant_id: int) -> AppSettings:
    row = db.query(AppSettings).filter(AppSettings.tenant_id == tenant_id).one_or_none()
    if row is None:
        row = AppSettings(tenant_id=tenant_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return (slug[:60] or "tenant")


def user_to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        job_title=user.job_title,
        department=user.department,
        phone=user.phone,
        role=user.role,  # type: ignore[arg-type]
        timezone=user.timezone,
        locale=user.locale,
        notify_email=user.notify_email,
        notify_in_app=user.notify_in_app,
        active=bool(user.active),
        tenant_id=user.tenant_id,
    )


def org_to_out(row: AppSettings) -> OrgProfileOut:
    return OrgProfileOut(
        company_name=row.company_name or "",
        industry=row.industry or "",
        address=row.address or "",
        timezone=row.timezone or "UTC",
        accent_color=row.accent_color or "#0f766e",
    )


def tenant_to_out(row: Tenant, db: Session | None = None) -> TenantOut:
    user_count = 0
    equipment_count = 0
    overdue_count = 0
    if db is not None:
        user_count = db.query(User).filter(User.tenant_id == row.id).count()
        equipment_count = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == row.id).count()
        overdue_count = (
            db.query(EquipmentCache)
            .filter(EquipmentCache.tenant_id == row.id, EquipmentCache.status == "overdue")
            .count()
        )
    return TenantOut(
        id=row.id,
        slug=row.slug,
        name=row.name,
        active=bool(row.active),
        created_at=row.created_at,
        user_count=user_count,
        equipment_count=equipment_count,
        overdue_count=overdue_count,
    )


def tenant_to_detail(row: Tenant, db: Session) -> TenantDetailOut:
    base = tenant_to_out(row, db)
    settings = db.query(AppSettings).filter(AppSettings.tenant_id == row.id).one_or_none()
    return TenantDetailOut(
        **base.model_dump(),
        company_name=(settings.company_name if settings else "") or row.name,
        industry=(settings.industry if settings else "") or "",
        address=(settings.address if settings else "") or "",
        timezone=(settings.timezone if settings else None) or "UTC",
        accent_color=(settings.accent_color if settings else None) or "#0f766e",
    )


def _membership_tenant_ids(db: Session, user: User) -> list[int]:
    return [
        m.tenant_id
        for m in db.query(TenantMembership).filter(TenantMembership.user_id == user.id).all()
    ]


def notification_to_out(row: AppNotification) -> AppNotificationOut:
    return AppNotificationOut(
        id=row.public_id,
        type=row.type,
        title=row.title,
        body=row.body,
        when=row.event_date,
        read=row.read,
        equipment_id=row.equipment_public_id,
        created_at=row.created_at,
    )


def email_audit_to_out(row: EmailAuditLog) -> EmailAuditOut:
    return EmailAuditOut(
        id=row.id,
        kind=row.kind,
        subject=row.subject,
        to_email=row.to_email,
        to_name=row.to_name,
        status=row.status,
        error=row.error,
        equipment_count=row.equipment_count,
        detail=row.detail,
        org_member=bool(row.org_member),
        created_at=row.created_at,
    )


def _issue_token(db: Session, user: User, tenant_id: int) -> AuthTokenOut:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or not tenant.active:
        raise HTTPException(status_code=400, detail="Workspace not found or inactive")
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=403, detail="You do not have access to this workspace")
    token = create_access_token(
        user_id=user.id,
        email=user.email,
        tenant_id=tenant_id,
        role=user.role,
    )
    return AuthTokenOut(
        access_token=token,
        user=user_to_out(user),
        tenant_id=tenant_id,
        tenant_name=tenant.name,
    )


def _resolve_login_tenant_id(db: Session, user: User, requested: int | None) -> int:
    if user.role == PLATFORM_ADMIN:
        memberships = (
            db.query(TenantMembership)
            .filter(TenantMembership.user_id == user.id)
            .order_by(TenantMembership.id.asc())
            .all()
        )
        if not memberships:
            raise HTTPException(
                status_code=403,
                detail="This platform account has no workspace memberships yet",
            )
        allowed = {m.tenant_id for m in memberships}
        if requested is not None:
            if requested not in allowed:
                raise HTTPException(status_code=403, detail="You do not have access to this workspace")
            return requested
        return memberships[0].tenant_id
    if user.tenant_id is None:
        raise HTTPException(status_code=403, detail="Account is not assigned to a workspace")
    if requested is not None and requested != user.tenant_id:
        raise HTTPException(status_code=403, detail="You can only access your own workspace")
    return int(user.tenant_id)


@router.get("/auth/status")
def auth_status(db: Session = Depends(get_db)) -> dict:
    count = db.query(User).count()
    return {"has_users": count > 0, "user_count": count}


@router.post("/auth/register", response_model=AuthTokenOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> AuthTokenOut:
    """Public registration is disabled — accounts are invite / admin-created only."""
    raise HTTPException(
        status_code=403,
        detail="TrueGage is invite only. Ask your organization admin to create your login.",
    )


@router.post("/auth/login", response_model=AuthTokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)) -> AuthTokenOut:
    email = _normalize_email(body.email)
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.active:
        raise HTTPException(status_code=401, detail="This account is inactive")
    tenant_id = _resolve_login_tenant_id(db, user, body.tenant_id)
    return _issue_token(db, user, tenant_id)


@router.get("/auth/me", response_model=MeOut)
def me(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> MeOut:
    tenant = db.get(Tenant, ctx.tenant_id)
    data = user_to_out(ctx.user).model_dump()
    data["tenant_id"] = ctx.tenant_id
    data["tenant_name"] = tenant.name if tenant else ""
    return MeOut(**data)


@router.patch("/auth/me", response_model=UserOut)
def update_me(
    body: UserUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    data = body.model_dump(exclude_unset=True)
    # Org users cannot elevate to platform_admin via self-service
    if "role" in data and user.role != PLATFORM_ADMIN:
        data.pop("role", None)
    if "password" in data:
        pw = data.pop("password")
        if pw:
            user.password_hash = hash_password(pw)
    if "email" in data and data["email"] is not None:
        email = _normalize_email(data["email"])
        if "@" not in email:
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        clash = db.query(User).filter(User.email == email, User.id != user.id).one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = email
        data.pop("email")
    for key, value in data.items():
        if isinstance(value, str) and key not in ("role", "timezone", "locale"):
            value = value.strip()
        setattr(user, key, value)
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


@router.get("/platform/overview", response_model=PlatformOverviewOut)
def platform_overview(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformOverviewOut:
    ids = _membership_tenant_ids(db, user)
    if not ids:
        return PlatformOverviewOut(
            tenant_count=0,
            user_count=0,
            equipment_count=0,
            overdue_count=0,
            recent_tenants=[],
        )
    tenants = (
        db.query(Tenant)
        .filter(Tenant.id.in_(ids))
        .order_by(Tenant.created_at.desc())
        .all()
    )
    user_count = db.query(User).filter(User.tenant_id.in_(ids)).count()
    equipment_count = db.query(EquipmentCache).filter(EquipmentCache.tenant_id.in_(ids)).count()
    overdue_count = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id.in_(ids), EquipmentCache.status == "overdue")
        .count()
    )
    recent = [tenant_to_out(t, db) for t in tenants[:8]]
    return PlatformOverviewOut(
        tenant_count=len(tenants),
        user_count=user_count,
        equipment_count=equipment_count,
        overdue_count=overdue_count,
        recent_tenants=recent,
    )


@router.get("/tenants", response_model=TenantListOut)
def list_tenants(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> TenantListOut:
    ids = _membership_tenant_ids(db, user)
    if not ids:
        return TenantListOut(items=[], total=0)
    rows = (
        db.query(Tenant)
        .filter(Tenant.id.in_(ids))
        .order_by(Tenant.name.asc())
        .all()
    )
    return TenantListOut(items=[tenant_to_out(r, db) for r in rows], total=len(rows))


@router.get("/tenants/{tenant_id}", response_model=TenantDetailOut)
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> TenantDetailOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    row = db.get(Tenant, tenant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant_to_detail(row, db)


@router.patch("/tenants/{tenant_id}", response_model=TenantDetailOut)
def update_tenant(
    tenant_id: int,
    body: TenantUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> TenantDetailOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    row = db.get(Tenant, tenant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Company not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="Company name is required")
        row.name = name
        settings = db.query(AppSettings).filter(AppSettings.tenant_id == tenant_id).one_or_none()
        if settings is not None:
            settings.company_name = name
    if "active" in data and data["active"] is not None:
        row.active = bool(data["active"])
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return tenant_to_detail(row, db)


@router.post("/tenants", response_model=TenantOut, status_code=201)
def create_tenant(
    body: TenantCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> TenantOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name is required")
    base_slug = _slugify(body.slug.strip() if body.slug else name)
    slug = base_slug
    n = 2
    while db.query(Tenant).filter(Tenant.slug == slug).one_or_none() is not None:
        slug = f"{base_slug}-{n}"[:64]
        n += 1

    tenant = Tenant(slug=slug, name=name, active=True)
    db.add(tenant)
    db.flush()

    settings = AppSettings(tenant_id=tenant.id, company_name=name)
    db.add(settings)
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))

    admin_email = (body.admin_email or "").strip()
    admin_password = (body.admin_password or "").strip()
    if admin_email or admin_password:
        if not admin_email or not admin_password:
            raise HTTPException(
                status_code=400,
                detail="Provide both admin_email and admin_password to create an org admin",
            )
        email = _normalize_email(admin_email)
        if "@" not in email or "." not in email.split("@")[-1]:
            raise HTTPException(status_code=400, detail="Enter a valid admin email address")
        if len(admin_password) < 8:
            raise HTTPException(status_code=400, detail="Admin password must be at least 8 characters")
        existing = db.query(User).filter(User.email == email).one_or_none()
        if existing is not None:
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        full_name = (body.admin_full_name or "").strip() or email.split("@")[0]
        db.add(
            User(
                tenant_id=tenant.id,
                email=email,
                password_hash=hash_password(admin_password),
                full_name=full_name,
                role="admin",
                active=True,
            )
        )

    db.commit()
    db.refresh(tenant)
    return tenant_to_out(tenant, db)


@router.post("/tenants/{tenant_id}/switch", response_model=AuthTokenOut)
def switch_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> AuthTokenOut:
    return _issue_token(db, user, tenant_id)


@router.get("/users", response_model=UserListOut)
def list_users(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> UserListOut:
    rows = (
        db.query(User)
        .filter(User.tenant_id == ctx.tenant_id)
        .order_by(User.full_name.asc(), User.email.asc())
        .all()
    )
    return UserListOut(items=[user_to_out(r) for r in rows], total=len(rows))


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    body: AdminUserCreateIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> UserOut:
    email = _normalize_email(body.email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    existing = db.query(User).filter(User.email == email).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    full_name = body.full_name.strip() or email.split("@")[0]
    user = User(
        tenant_id=ctx.tenant_id,
        email=email,
        password_hash=hash_password(body.password),
        full_name=full_name,
        role=body.role,
        job_title=body.job_title.strip(),
        department=body.department.strip(),
        active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def admin_update_user(
    user_id: int,
    body: AdminUserUpdateIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> UserOut:
    row = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == ctx.tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")

    data = body.model_dump(exclude_unset=True)
    if "password" in data:
        pw = data.pop("password")
        if pw:
            row.password_hash = hash_password(pw)
    if "email" in data and data["email"] is not None:
        email = _normalize_email(data["email"])
        if "@" not in email:
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        clash = db.query(User).filter(User.email == email, User.id != row.id).one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="Email already in use")
        row.email = email
        data.pop("email")
    if "active" in data and data["active"] is False and row.id == ctx.user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    if "role" in data and data["role"] != "admin" and row.id == ctx.user.id and ctx.user.role == "admin":
        other_admins = (
            db.query(User)
            .filter(
                User.tenant_id == ctx.tenant_id,
                User.role == "admin",
                User.active.is_(True),
                User.id != ctx.user.id,
            )
            .count()
        )
        if other_admins == 0:
            raise HTTPException(
                status_code=400,
                detail="Promote another admin before changing your own role",
            )

    for key, value in data.items():
        if isinstance(value, str) and key not in ("role",):
            value = value.strip()
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return user_to_out(row)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> Response:
    row = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == ctx.tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if row.id == ctx.user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if row.role == "admin":
        other_admins = (
            db.query(User)
            .filter(
                User.tenant_id == ctx.tenant_id,
                User.role == "admin",
                User.active.is_(True),
                User.id != row.id,
            )
            .count()
        )
        if other_admins == 0:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin account")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/org", response_model=OrgProfileOut)
def get_org(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> OrgProfileOut:
    return org_to_out(get_or_create_settings(db, ctx.tenant_id))


@router.put("/org", response_model=OrgProfileOut)
def save_org(
    body: OrgProfileIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> OrgProfileOut:
    row = get_or_create_settings(db, ctx.tenant_id)
    row.company_name = body.company_name.strip()
    row.industry = body.industry.strip()
    row.address = body.address.strip() or None
    row.timezone = body.timezone.strip() or "UTC"
    accent = body.accent_color.strip() or "#0f766e"
    if not accent.startswith("#"):
        accent = f"#{accent}"
    row.accent_color = accent[:32]
    # Keep tenant.name in sync with company display name
    tenant = db.get(Tenant, ctx.tenant_id)
    if tenant is not None and row.company_name:
        tenant.name = row.company_name
    db.commit()
    db.refresh(row)
    return org_to_out(row)


@router.get("/notifications", response_model=AppNotificationListOut)
def list_notifications(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> AppNotificationListOut:
    rows = sync_due_date_notifications(db, ctx.tenant_id)
    unread = sum(1 for r in rows if not r.read)
    return AppNotificationListOut(
        items=[notification_to_out(r) for r in rows],
        total=len(rows),
        unread=unread,
    )


@router.post("/notifications/mark-all-read", response_model=AppNotificationListOut)
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> AppNotificationListOut:
    sync_due_date_notifications(db, ctx.tenant_id)
    db.query(AppNotification).filter(
        AppNotification.tenant_id == ctx.tenant_id,
        AppNotification.read.is_(False),
    ).update({"read": True}, synchronize_session=False)
    db.commit()
    rows = (
        db.query(AppNotification)
        .filter(AppNotification.tenant_id == ctx.tenant_id)
        .order_by(AppNotification.created_at.desc(), AppNotification.id.desc())
        .all()
    )
    return AppNotificationListOut(
        items=[notification_to_out(r) for r in rows],
        total=len(rows),
        unread=0,
    )


@router.patch("/notifications/{notification_id}/read", response_model=AppNotificationOut)
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> AppNotificationOut:
    row = (
        db.query(AppNotification)
        .filter(
            AppNotification.public_id == notification_id,
            AppNotification.tenant_id == ctx.tenant_id,
        )
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.read = True
    db.commit()
    db.refresh(row)
    return notification_to_out(row)


@router.get("/email/history", response_model=EmailAuditListOut)
def list_email_history(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    limit: int = 100,
) -> EmailAuditListOut:
    limit = max(1, min(limit, 500))
    query = db.query(EmailAuditLog).filter(EmailAuditLog.tenant_id == ctx.tenant_id)
    if not is_org_admin_role(ctx.user.role):
        query = query.filter(EmailAuditLog.org_member.is_(True))
    total = query.count()
    rows = (
        query.order_by(EmailAuditLog.created_at.desc(), EmailAuditLog.id.desc())
        .limit(limit)
        .all()
    )
    return EmailAuditListOut(items=[email_audit_to_out(r) for r in rows], total=total)


def log_email_send(
    db: Session,
    *,
    tenant_id: int,
    kind: str,
    subject: str,
    to_email: str,
    to_name: str,
    status: str,
    error: str | None = None,
    equipment_count: int = 0,
    detail: str | None = None,
    org_member: bool = True,
) -> EmailAuditLog:
    row = EmailAuditLog(
        tenant_id=tenant_id,
        kind=kind,
        subject=subject,
        to_email=to_email,
        to_name=to_name or "",
        status=status,
        error=error,
        equipment_count=equipment_count,
        detail=detail,
        org_member=org_member,
    )
    db.add(row)
    db.flush()
    return row


def notify_email_batch(
    db: Session,
    *,
    tenant_id: int,
    kind: str,
    sent: int,
    failed: int,
    equipment_count: int = 0,
) -> None:
    source = f"email-{kind}-{uuid4().hex[:10]}"
    if kind == "overdue_alert":
        title = "Overdue alert email sent"
        body = f"Sent {sent} overdue alert email(s)"
        if failed:
            body += f"; {failed} failed"
        if equipment_count:
            body += f" covering {equipment_count} equipment item(s)."
        else:
            body += "."
    else:
        title = "Check email sent"
        body = f"Sent {sent} SMTP check email(s)"
        if failed:
            body += f"; {failed} failed."
        else:
            body += "."
    add_system_notification(
        db,
        tenant_id=tenant_id,
        source_key=source,
        title=title,
        body=body,
        type_="activity",
    )
