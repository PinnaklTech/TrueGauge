"""Auth, org profile, tenants, notifications inbox, email audit history."""

from __future__ import annotations

import logging
import hmac
import json
import re
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import (
    PLATFORM_ADMIN,
    TenantContext,
    get_current_user,
    get_optional_user,
    get_tenant_context,
    require_admin,
    require_platform_admin,
    require_writer,
    user_can_access_tenant,
)
from app.models import (
    AppNotification,
    AppSettings,
    AuditEvent,
    AuthEvent,
    CalibrationRecord,
    EmailAuditLog,
    EquipmentCache,
    HandoffCode,
    NotificationRead,
    NotificationRecipient,
    RefreshToken,
    ReminderDispatch,
    ReminderJob,
    Tenant,
    TenantMembership,
    User,
)
from app.rate_limit import login_limiter
from app.schemas import (
    AdminUserCreateIn,
    AdminUserUpdateIn,
    AppNotificationListOut,
    AppNotificationOut,
    AuthTokenOut,
    ChecklistItemOut,
    DayCountOut,
    EmailAuditListOut,
    EmailAuditOut,
    ForcePasswordIn,
    HandoffCreateOut,
    HandoffExchangeIn,
    LoginIn,
    MeOut,
    OrgProfileIn,
    OrgProfileOut,
    OrgTaxonomyIn,
    OrgTaxonomyOut,
    OrgTaxonomyTermIn,
    OrgTaxonomyTermRenameIn,
    PlatformActivityItem,
    PlatformActivityOut,
    PlatformDataSummaryOut,
    PlatformDataTableOut,
    PlatformEmailQueueItem,
    PlatformEmailQueueOut,
    PlatformHealthOut,
    PlatformOverviewOut,
    PlatformSmtpIn,
    PlatformSmtpOut,
    PlatformSmtpTestIn,
    PlatformSmtpTestOut,
    PlatformStaffCreateIn,
    PlatformStaffUpdateIn,
    PlatformTenantEquipmentListOut,
    PlatformTenantEquipmentOut,
    PlatformTenantSummaryOut,
    PlatformUserListOut,
    PlatformUserOut,
    RefreshIn,
    RegisterIn,
    ReminderRulesIn,
    ReminderRulesOut,
    ReminderTickOut,
    ReminderJobOut,
    ReminderSendOut,
    ReminderLogOut,
    SendCredentialsIn,
    StaffLoginIn,
    TenantCreateIn,
    TenantDetailOut,
    TenantListOut,
    TenantOut,
    TenantUpdateIn,
    TourCompleteIn,
    UserListOut,
    UserOut,
    UserUpdateIn,
    WelcomeEmailIn,
)
from app.security import (
    create_access_token,
    encrypt_secret,
    hash_opaque_token,
    hash_password,
    needs_rehash,
    new_opaque_token,
    verify_password,
    verify_password_with_dummy,
)
from app.ssrf import validate_smtp_host
from app.services.email_service import (
    EmailError,
    build_message,
    get_or_create_platform_settings,
    is_system_smtp_ready,
    load_smtp_config,
    load_system_smtp_config,
    platform_smtp_configured,
    send_company_welcome_email,
    send_login_credentials_email,
    send_message,
    smtp_configured,
)
from app.services import r2_storage
from app.services.notifications import add_system_notification, sync_due_date_notifications
from app.services.reminder_engine import last_daily_run_at, run_reminder_tick
from app.services.storage_quota import (
    storage_fields_for_tenant,
    tenant_certificate_count,
    tenant_storage_usage,
)
router = APIRouter()
logger = logging.getLogger("truegauge.auth")


def _record_auth_event(
    db: Session,
    *,
    kind: str,
    status: str = "ok",
    email: str = "",
    user_id: int | None = None,
    tenant_id: int | None = None,
    ip: str = "",
    detail: str = "",
) -> None:
    db.add(
        AuthEvent(
            kind=kind,
            status=status,
            email=(email or "")[:255],
            user_id=user_id,
            tenant_id=tenant_id,
            ip=(ip or "")[:64],
            detail=(detail or "")[:512],
        )
    )


def _odoo_configured(row: AppSettings | None) -> bool:
    if row is None:
        return False
    return bool(row.odoo_url and row.odoo_database and row.odoo_username and row.odoo_api_key_encrypted)


def _passcode_ok(provided: str) -> bool:
    settings = get_settings()
    expected = (settings.master_admin_passcode or "").strip()
    if not expected:
        # Local/dev convenience only — production validator requires a real code
        if settings.is_production:
            return False
        expected = "000000"
    provided_n = (provided or "").strip()
    if len(expected) != len(provided_n):
        return False
    return hmac.compare_digest(expected.encode("utf-8"), provided_n.encode("utf-8"))


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


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _bump_token_version(user: User) -> None:
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1


def _revoke_refresh_tokens(db: Session, user_id: int) -> None:
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked.is_(False),
    ).update({"revoked": True}, synchronize_session=False)


def _create_refresh_token(db: Session, user: User, tenant_id: int) -> str:
    settings = get_settings()
    raw = new_opaque_token()
    row = RefreshToken(
        user_id=user.id,
        tenant_id=tenant_id,
        token_hash=hash_opaque_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.refresh_token_ttl_seconds),
        revoked=False,
    )
    db.add(row)
    return raw


def _issue_token(db: Session, user: User, tenant_id: int) -> AuthTokenOut:
    settings = get_settings()
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
        token_version=int(getattr(user, "token_version", 0) or 0),
    )
    refresh = _create_refresh_token(db, user, tenant_id)
    db.commit()
    return AuthTokenOut(
        access_token=token,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_seconds,
        user=user_to_out(user),
        tenant_id=tenant_id,
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
    )


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
        updated_at=user.updated_at,
        profile_setup_at=getattr(user, "profile_setup_at", None),
        product_tour_at=getattr(user, "product_tour_at", None),
    )


def org_to_out(row: AppSettings) -> OrgProfileOut:
    return OrgProfileOut(
        company_name=row.company_name or "",
        industry=row.industry or "",
        address=row.address or "",
        timezone=row.timezone or "UTC",
        accent_color=row.accent_color or "#0f766e",
    )


def _normalize_taxonomy_terms(items: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items or []:
        name = (raw or "").strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(name[:255])
    return out


def parse_taxonomy(row: AppSettings) -> OrgTaxonomyOut:
    raw = (getattr(row, "taxonomy_json", None) or "").strip()
    data: dict = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                data = parsed
        except json.JSONDecodeError:
            data = {}
    return OrgTaxonomyOut(
        departments=_normalize_taxonomy_terms(data.get("departments")),
        categories=_normalize_taxonomy_terms(data.get("categories")),
        locations=_normalize_taxonomy_terms(data.get("locations")),
    )


def apply_taxonomy(row: AppSettings, body: OrgTaxonomyIn) -> OrgTaxonomyOut:
    out = OrgTaxonomyOut(
        departments=_normalize_taxonomy_terms(body.departments),
        categories=_normalize_taxonomy_terms(body.categories),
        locations=_normalize_taxonomy_terms(body.locations),
    )
    row.taxonomy_json = json.dumps(
        {
            "departments": out.departments,
            "categories": out.categories,
            "locations": out.locations,
        },
        ensure_ascii=False,
    )
    return out


def _taxonomy_as_dict(tax: OrgTaxonomyOut) -> dict[str, list[str]]:
    return {
        "departments": list(tax.departments),
        "categories": list(tax.categories),
        "locations": list(tax.locations),
    }


def _equipment_field_for_kind(kind: str) -> str | None:
    return {
        "departments": "department",
        "categories": "category",
        "locations": "location",
    }.get(kind)


def add_taxonomy_term(row: AppSettings, kind: str, value: str) -> OrgTaxonomyOut:
    current = _taxonomy_as_dict(parse_taxonomy(row))
    terms = current[kind]
    cleaned = (value or "").strip()[:255]
    if not cleaned:
        raise HTTPException(status_code=400, detail="Value is required")
    if any(t.casefold() == cleaned.casefold() for t in terms):
        raise HTTPException(status_code=400, detail="Already in the list")
    terms.append(cleaned)
    return apply_taxonomy(row, OrgTaxonomyIn(**current))


def rename_taxonomy_term(
    db: Session,
    tenant_id: int,
    row: AppSettings,
    kind: str,
    from_value: str,
    to_value: str,
) -> OrgTaxonomyOut:
    current = _taxonomy_as_dict(parse_taxonomy(row))
    terms = current[kind]
    src = (from_value or "").strip()
    dst = (to_value or "").strip()[:255]
    if not src or not dst:
        raise HTTPException(status_code=400, detail="Both from and to values are required")
    idx = next((i for i, t in enumerate(terms) if t.casefold() == src.casefold()), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Term not found")
    if any(i != idx and t.casefold() == dst.casefold() for i, t in enumerate(terms)):
        raise HTTPException(status_code=400, detail="Already in the list")
    old_name = terms[idx]
    terms[idx] = dst
    out = apply_taxonomy(row, OrgTaxonomyIn(**current))
    field = _equipment_field_for_kind(kind)
    if field and old_name != dst:
        db.query(EquipmentCache).filter(
            EquipmentCache.tenant_id == tenant_id,
            getattr(EquipmentCache, field) == old_name,
        ).update({field: dst}, synchronize_session=False)
        if kind == "departments":
            db.query(User).filter(
                User.tenant_id == tenant_id,
                User.department == old_name,
            ).update({"department": dst}, synchronize_session=False)
    return out


def remove_taxonomy_term(row: AppSettings, kind: str, value: str) -> OrgTaxonomyOut:
    current = _taxonomy_as_dict(parse_taxonomy(row))
    terms = current[kind]
    target = (value or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="Value is required")
    next_terms = [t for t in terms if t.casefold() != target.casefold()]
    if len(next_terms) == len(terms):
        raise HTTPException(status_code=404, detail="Term not found")
    current[kind] = next_terms
    return apply_taxonomy(row, OrgTaxonomyIn(**current))


def seed_taxonomy_from_equipment(db: Session, tenant_id: int) -> OrgTaxonomyOut:
    rows = (
        db.query(EquipmentCache.department, EquipmentCache.category, EquipmentCache.location)
        .filter(EquipmentCache.tenant_id == tenant_id)
        .all()
    )
    departments: list[str] = []
    categories: list[str] = []
    locations: list[str] = []
    for dept, cat, loc in rows:
        if dept:
            departments.append(dept)
        if cat:
            categories.append(cat)
        if loc:
            locations.append(loc)
    return OrgTaxonomyOut(
        departments=_normalize_taxonomy_terms(departments),
        categories=_normalize_taxonomy_terms(categories),
        locations=_normalize_taxonomy_terms(locations),
    )


def tenant_to_out(row: Tenant, db: Session | None = None) -> TenantOut:
    user_count = 0
    equipment_count = 0
    overdue_count = 0
    smtp_ok = False
    odoo_ok = False
    if db is not None:
        user_count = db.query(User).filter(User.tenant_id == row.id).count()
        equipment_count = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == row.id).count()
        overdue_count = (
            db.query(EquipmentCache)
            .filter(EquipmentCache.tenant_id == row.id, EquipmentCache.status == "overdue")
            .count()
        )
        settings = db.query(AppSettings).filter(AppSettings.tenant_id == row.id).one_or_none()
        smtp_ok = smtp_configured(settings) if settings else False
        odoo_ok = _odoo_configured(settings)
    return TenantOut(
        id=row.id,
        slug=row.slug,
        name=row.name,
        active=bool(row.active),
        storage_enabled=bool(getattr(row, "storage_enabled", False)),
        created_at=row.created_at,
        user_count=user_count,
        equipment_count=equipment_count,
        overdue_count=overdue_count,
        smtp_configured=smtp_ok,
        odoo_configured=odoo_ok,
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
    """Tenant IDs visible in Staff Console. Platform admins see every company."""
    if user.role == PLATFORM_ADMIN:
        return [int(r[0]) for r in db.query(Tenant.id).order_by(Tenant.id.asc()).all()]
    return [
        m.tenant_id
        for m in db.query(TenantMembership).filter(TenantMembership.user_id == user.id).all()
    ]


def notification_to_out(row: AppNotification, *, read: bool | None = None) -> AppNotificationOut:
    return AppNotificationOut(
        id=row.public_id,
        type=row.type,
        title=row.title,
        body=row.body,
        when=row.event_date,
        read=bool(row.read) if read is None else read,
        equipment_id=row.equipment_public_id,
        created_at=row.created_at,
    )


def _user_read_notification_ids(db: Session, user_id: int, notification_ids: list[int]) -> set[int]:
    if not notification_ids:
        return set()
    rows = (
        db.query(NotificationRead.notification_id)
        .filter(
            NotificationRead.user_id == user_id,
            NotificationRead.notification_id.in_(notification_ids),
        )
        .all()
    )
    return {r[0] for r in rows}


def _mark_notifications_read_for_user(
    db: Session,
    *,
    user_id: int,
    notification_ids: list[int],
) -> None:
    if not notification_ids:
        return
    already = _user_read_notification_ids(db, user_id, notification_ids)
    for nid in notification_ids:
        if nid in already:
            continue
        db.add(NotificationRead(user_id=user_id, notification_id=nid))


def notifications_list_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
) -> AppNotificationListOut:
    rows = sync_due_date_notifications(db, tenant_id)
    user = db.get(User, user_id)
    if user is not None and not user.notify_in_app:
        rows = [r for r in rows if r.type != "reminder"]
    read_ids = _user_read_notification_ids(db, user_id, [r.id for r in rows])
    items = [notification_to_out(r, read=r.id in read_ids) for r in rows]
    unread = sum(1 for item in items if not item.read)
    return AppNotificationListOut(items=items, total=len(items), unread=unread)


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
    # Do not expose user_count publicly
    count = db.query(User).count()
    return {"has_users": count > 0}


@router.post("/auth/register", response_model=AuthTokenOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> AuthTokenOut:
    """Public registration is disabled — accounts are invite / admin-created only."""
    raise HTTPException(
        status_code=403,
        detail="TrueGage is invite only. Ask your organization admin to create your login.",
    )


@router.post("/auth/login", response_model=AuthTokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> AuthTokenOut:
    settings = get_settings()
    ip = _client_ip(request)
    if not login_limiter.hit(
        f"login:{ip}",
        limit=settings.login_rate_limit_per_minute,
        window_seconds=60.0,
    ):
        logger.warning("auth.login_rate_limited ip=%s", ip)
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Try again shortly.")

    email = _normalize_email(body.email)
    user = db.query(User).filter(User.email == email).one_or_none()
    ok = verify_password_with_dummy(body.password, user.password_hash if user else None)
    if user is None or not ok:
        logger.info("auth.login_failed ip=%s email=%s", ip, email)
        _record_auth_event(db, kind="login", status="failed", email=email, ip=ip, detail="invalid credentials")
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.active:
        logger.info("auth.login_inactive ip=%s user_id=%s", ip, user.id)
        _record_auth_event(
            db, kind="login", status="failed", email=email, user_id=user.id, ip=ip, detail="inactive"
        )
        db.commit()
        raise HTTPException(status_code=401, detail="This account is inactive")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.add(user)
    tenant_id = _resolve_login_tenant_id(db, user, body.tenant_id)
    logger.info("auth.login_ok ip=%s user_id=%s tenant_id=%s", ip, user.id, tenant_id)
    _record_auth_event(
        db, kind="login", status="ok", email=email, user_id=user.id, tenant_id=tenant_id, ip=ip
    )
    return _issue_token(db, user, tenant_id)


@router.post("/auth/staff-login", response_model=AuthTokenOut)
def staff_login(body: StaffLoginIn, request: Request, db: Session = Depends(get_db)) -> AuthTokenOut:
    """Master Admin only — platform_admin + shared 6-digit staff passcode."""
    settings = get_settings()
    ip = _client_ip(request)
    if not login_limiter.hit(
        f"staff-login:{ip}",
        limit=settings.login_rate_limit_per_minute,
        window_seconds=60.0,
    ):
        logger.warning("auth.staff_login_rate_limited ip=%s", ip)
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Try again shortly.")

    email = _normalize_email(body.email)
    user = db.query(User).filter(User.email == email).one_or_none()
    ok = verify_password_with_dummy(body.password, user.password_hash if user else None)
    code_ok = _passcode_ok(body.passcode)

    if user is None or not ok or not code_ok:
        logger.info("auth.staff_login_failed ip=%s email=%s", ip, email)
        _record_auth_event(
            db,
            kind="staff_login",
            status="failed",
            email=email,
            user_id=user.id if user else None,
            ip=ip,
            detail="invalid credentials or passcode",
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid staff credentials")

    if user.role != PLATFORM_ADMIN:
        logger.info("auth.staff_login_denied ip=%s user_id=%s", ip, user.id)
        _record_auth_event(
            db,
            kind="staff_login",
            status="denied",
            email=email,
            user_id=user.id,
            ip=ip,
            detail="not platform_admin",
        )
        db.commit()
        raise HTTPException(
            status_code=403,
            detail="Master Admin is for TrueGage staff only. Workspace users cannot sign in here.",
        )

    if not user.active:
        raise HTTPException(status_code=401, detail="This account is inactive")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.add(user)

    tenant_id = _resolve_login_tenant_id(db, user, None)
    logger.info("auth.staff_login_ok ip=%s user_id=%s tenant_id=%s", ip, user.id, tenant_id)
    _record_auth_event(
        db,
        kind="staff_login",
        status="ok",
        email=email,
        user_id=user.id,
        tenant_id=tenant_id,
        ip=ip,
    )
    return _issue_token(db, user, tenant_id)


@router.post("/auth/refresh", response_model=AuthTokenOut)
def refresh_session(
    body: RefreshIn,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthTokenOut:
    settings = get_settings()
    ip = _client_ip(request)
    if not login_limiter.hit(
        f"refresh:{ip}",
        limit=max(settings.login_rate_limit_per_minute * 6, 30),
        window_seconds=60.0,
    ):
        logger.warning("auth.refresh_rate_limited ip=%s", ip)
        raise HTTPException(status_code=429, detail="Too many refresh attempts. Try again shortly.")

    token_hash = hash_opaque_token(body.refresh_token.strip())
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).one_or_none()
    now = datetime.now(timezone.utc)
    if (
        row is None
        or row.revoked
        or row.expires_at.replace(tzinfo=timezone.utc) < now
    ):
        raise HTTPException(status_code=401, detail="Refresh token invalid or expired")
    user = db.get(User, row.user_id)
    if user is None or not user.active:
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    # Rotate refresh token
    row.revoked = True
    db.add(row)
    return _issue_token(db, user, row.tenant_id)


@router.post("/auth/logout", status_code=204)
def logout(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    _bump_token_version(user)
    _revoke_refresh_tokens(db, user.id)
    db.commit()
    logger.info("auth.logout user_id=%s", user.id)
    return Response(status_code=204)


@router.get("/auth/me", response_model=MeOut)
def me(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> MeOut:
    tenant = db.get(Tenant, ctx.tenant_id)
    data = user_to_out(ctx.user).model_dump()
    data["tenant_id"] = ctx.tenant_id
    data["tenant_name"] = tenant.name if tenant else ""
    data["tenant_slug"] = tenant.slug if tenant else ""
    data.update(storage_fields_for_tenant(db, tenant))
    return MeOut(**data)


@router.patch("/auth/me", response_model=UserOut)
def update_me(
    body: UserUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    data = body.model_dump(exclude_unset=True)
    mark_profile_setup = bool(data.pop("mark_profile_setup", False))
    # Org users cannot elevate to platform_admin via self-service; strip role entirely for non-platform
    if user.role != PLATFORM_ADMIN:
        data.pop("role", None)
    else:
        # Platform admins also should not self-change role via profile
        data.pop("role", None)

    changing_password = bool(data.get("password"))
    changing_email = "email" in data and data["email"] is not None
    if changing_password or changing_email:
        current = data.pop("current_password", None)
        if not current or not verify_password(current, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is required to change email or password")
    else:
        data.pop("current_password", None)

    if "password" in data:
        pw = data.pop("password")
        if pw:
            if len(pw) < 6:
                raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
            user.password_hash = hash_password(pw)
            _bump_token_version(user)
            _revoke_refresh_tokens(db, user.id)
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
        if isinstance(value, str) and key not in ("timezone", "locale"):
            value = value.strip()
        setattr(user, key, value)

    # First-login profile step: mark complete for non-admins
    if user.role not in ("admin", PLATFORM_ADMIN) and user.profile_setup_at is None:
        profile_touched = any(
            k in body.model_dump(exclude_unset=True)
            for k in ("full_name", "job_title", "department", "timezone", "notify_email", "notify_in_app")
        )
        if mark_profile_setup or profile_touched:
            user.profile_setup_at = datetime.now(timezone.utc)

    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


@router.post("/auth/onboarding/tour-complete", response_model=UserOut)
def complete_product_tour(
    body: TourCompleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Mark product tour finished or skipped (non-admins)."""
    if user.role in ("admin", PLATFORM_ADMIN):
        return user_to_out(user)
    if user.product_tour_at is None:
        user.product_tour_at = datetime.now(timezone.utc)
        user.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
    return user_to_out(user)


@router.post("/auth/onboarding/tour-reset", response_model=UserOut)
def reset_product_tour(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Allow non-admins to replay the product tour from Profile."""
    if user.role in ("admin", PLATFORM_ADMIN):
        raise HTTPException(status_code=403, detail="Product tour is for workspace members only")
    user.product_tour_at = None
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


@router.get("/platform/overview", response_model=PlatformOverviewOut)
def platform_overview(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformOverviewOut:
    settings = get_settings()
    ids = _membership_tenant_ids(db, user)
    empty = PlatformOverviewOut(
        tenant_count=0,
        active_tenant_count=0,
        inactive_tenant_count=0,
        user_count=0,
        staff_count=db.query(User).filter(User.role == PLATFORM_ADMIN).count(),
        recent_tenants=[],
        system_status="ok",
        database_status="up",
        system_smtp_ready=is_system_smtp_ready(db),
    )
    if not ids:
        return empty

    tenants = (
        db.query(Tenant)
        .filter(Tenant.id.in_(ids))
        .order_by(Tenant.created_at.desc())
        .all()
    )
    active_count = sum(1 for t in tenants if t.active)
    inactive_count = len(tenants) - active_count
    user_count = (
        db.query(User)
        .filter(User.tenant_id.in_(ids), User.role != PLATFORM_ADMIN)
        .count()
    )
    staff_count = db.query(User).filter(User.role == PLATFORM_ADMIN).count()

    since_7d = datetime.now(timezone.utc) - timedelta(days=7)
    since_30d = datetime.now(timezone.utc) - timedelta(days=30)
    email_rows = (
        db.query(EmailAuditLog)
        .filter(EmailAuditLog.tenant_id.in_(ids), EmailAuditLog.created_at >= since_7d)
        .all()
    )
    email_sent = sum(1 for r in email_rows if r.status == "sent")
    email_failed = sum(1 for r in email_rows if r.status != "sent")

    settings_rows = db.query(AppSettings).filter(AppSettings.tenant_id.in_(ids)).all()
    smtp_n = sum(1 for s in settings_rows if smtp_configured(s))
    odoo_n = sum(1 for s in settings_rows if _odoo_configured(s))

    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    auth_events_24h = db.query(AuthEvent).filter(AuthEvent.created_at >= since_24h).count()
    auth_failures_24h = (
        db.query(AuthEvent)
        .filter(AuthEvent.created_at >= since_24h, AuthEvent.status.in_(["failed", "denied"]))
        .count()
    )
    onboardings_30d = (
        db.query(AuthEvent)
        .filter(AuthEvent.kind == "tenant_onboard", AuthEvent.created_at >= since_30d)
        .count()
    )

    # Chart series (last 14 days)
    days = 14
    day_keys = []
    today = datetime.now(timezone.utc).date()
    series_since = datetime.now(timezone.utc) - timedelta(days=days)
    for i in range(days - 1, -1, -1):
        day_keys.append((today - timedelta(days=i)).isoformat())

    onboard_map = {k: 0 for k in day_keys}
    for row in (
        db.query(AuthEvent)
        .filter(AuthEvent.kind == "tenant_onboard", AuthEvent.created_at >= series_since)
        .all()
    ):
        if row.created_at:
            k = row.created_at.astimezone(timezone.utc).date().isoformat()
            if k in onboard_map:
                onboard_map[k] += 1

    email_map = {k: {"sent": 0, "failed": 0} for k in day_keys}
    for row in (
        db.query(EmailAuditLog)
        .filter(EmailAuditLog.tenant_id.in_(ids), EmailAuditLog.created_at >= series_since)
        .all()
    ):
        if row.created_at:
            k = row.created_at.astimezone(timezone.utc).date().isoformat()
            if k in email_map:
                if row.status == "sent":
                    email_map[k]["sent"] += 1
                else:
                    email_map[k]["failed"] += 1

    auth_map = {k: {"ok": 0, "fail": 0} for k in day_keys}
    for row in db.query(AuthEvent).filter(AuthEvent.created_at >= series_since).all():
        if row.created_at:
            k = row.created_at.astimezone(timezone.utc).date().isoformat()
            if k in auth_map:
                if row.status in ("failed", "denied"):
                    auth_map[k]["fail"] += 1
                else:
                    auth_map[k]["ok"] += 1

    recent = [tenant_to_out(t, db) for t in tenants[:8]]
    failed_welcomes_7d = (
        db.query(EmailAuditLog)
        .filter(
            EmailAuditLog.tenant_id.in_(ids),
            EmailAuditLog.kind == "welcome",
            EmailAuditLog.status != "sent",
            EmailAuditLog.created_at >= since_7d,
        )
        .count()
    )
    active_without_smtp = sum(
        1
        for t, s in zip(
            tenants,
            [next((x for x in settings_rows if x.tenant_id == t.id), None) for t in tenants],
        )
        if t.active and not smtp_configured(s)
    )
    return PlatformOverviewOut(
        tenant_count=len(tenants),
        active_tenant_count=active_count,
        inactive_tenant_count=inactive_count,
        user_count=user_count,
        staff_count=staff_count,
        email_7d_sent=email_sent,
        email_7d_failed=email_failed,
        smtp_configured_tenants=smtp_n,
        odoo_configured_tenants=odoo_n,
        auth_events_24h=auth_events_24h,
        auth_failures_24h=auth_failures_24h,
        onboardings_30d=onboardings_30d,
        equipment_count=0,
        overdue_count=0,
        recent_tenants=recent,
        system_status="ok",
        database_status="up",
        system_smtp_ready=is_system_smtp_ready(db),
        onboardings_by_day=[DayCountOut(date=k, count=onboard_map[k]) for k in day_keys],
        emails_by_day=[
            DayCountOut(date=k, sent=email_map[k]["sent"], failed=email_map[k]["failed"])
            for k in day_keys
        ],
        auth_by_day=[
            DayCountOut(date=k, ok=auth_map[k]["ok"], fail=auth_map[k]["fail"]) for k in day_keys
        ],
        attention_suspended=inactive_count,
        attention_failed_welcomes_7d=failed_welcomes_7d,
        attention_active_without_smtp=active_without_smtp,
    )


@router.get("/platform/health", response_model=PlatformHealthOut)
def platform_health(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformHealthOut:
    from sqlalchemy import text

    db_status = "up"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "down"
    return PlatformHealthOut(
        status="ok" if db_status == "up" else "degraded",
        database=db_status,
        environment=get_settings().environment,
    )


@router.get("/platform/activity", response_model=PlatformActivityOut)
def platform_activity(
    limit: int = 50,
    category: str = "all",
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformActivityOut:
    ids = _membership_tenant_ids(db, user)
    items: list[PlatformActivityItem] = []
    lim = max(1, min(limit, 200))
    cat = (category or "all").strip().lower()

    auth_rows = (
        db.query(AuthEvent)
        .order_by(AuthEvent.created_at.desc(), AuthEvent.id.desc())
        .limit(lim * 2)
        .all()
    )
    tenant_names = {
        t.id: t.name for t in db.query(Tenant).filter(Tenant.id.in_(ids)).all()
    } if ids else {}

    for row in auth_rows:
        tname = tenant_names.get(row.tenant_id or -1, "") if row.tenant_id else ""
        items.append(
            PlatformActivityItem(
                id=f"auth-{row.id}",
                kind=row.kind,
                title=row.kind.replace("_", " ").title(),
                detail=row.detail or row.email,
                status=row.status,
                tenant_id=row.tenant_id,
                tenant_name=tname,
                created_at=row.created_at,
            )
        )

    if ids:
        email_rows = (
            db.query(EmailAuditLog)
            .filter(EmailAuditLog.tenant_id.in_(ids))
            .order_by(EmailAuditLog.created_at.desc(), EmailAuditLog.id.desc())
            .limit(lim * 2)
            .all()
        )
        for row in email_rows:
            items.append(
                PlatformActivityItem(
                    id=f"email-{row.id}",
                    kind=f"email_{row.kind}",
                    title=row.subject or row.kind,
                    detail=f"{row.to_name} <{row.to_email}>".strip(),
                    status=row.status,
                    tenant_id=row.tenant_id,
                    tenant_name=tenant_names.get(row.tenant_id, ""),
                    created_at=row.created_at,
                )
            )

    def _matches(item: PlatformActivityItem) -> bool:
        k = item.kind.lower()
        if cat in ("", "all"):
            return True
        if cat == "onboarding":
            return k in ("tenant_onboard", "welcome_email", "email_welcome") or k.startswith(
                "email_welcome"
            )
        if cat == "auth":
            return k in (
                "staff_login",
                "login",
                "logout",
                "handoff",
                "force_password",
                "staff_create",
                "staff_update",
            ) or k.startswith("auth")
        if cat == "email":
            return k.startswith("email_") or k == "welcome_email"
        if cat in ("ops", "company"):
            return k in ("tenant_suspend", "tenant_activate", "tenant_onboard")
        return True

    items = [i for i in items if _matches(i)]
    items.sort(key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    items = items[:lim]
    return PlatformActivityOut(items=items, total=len(items))


@router.get("/platform/staff", response_model=PlatformUserListOut)
def list_platform_staff(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformUserListOut:
    rows = (
        db.query(User)
        .filter(User.role == PLATFORM_ADMIN)
        .order_by(User.full_name.asc(), User.email.asc())
        .all()
    )
    return PlatformUserListOut(
        items=[
            PlatformUserOut(
                id=r.id,
                email=r.email,
                full_name=r.full_name,
                role=r.role,
                active=r.active,
                tenant_id=r.tenant_id,
                tenant_name="",
                created_at=r.created_at,
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.post("/platform/staff", response_model=PlatformUserOut, status_code=201)
def create_platform_staff(
    body: PlatformStaffCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformUserOut:
    email = _normalize_email(body.email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    existing = db.query(User).filter(User.email == email).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    full_name = body.full_name.strip() or email.split("@")[0]
    row = User(
        tenant_id=None,
        email=email,
        password_hash=hash_password(body.password),
        full_name=full_name,
        role=PLATFORM_ADMIN,
        active=True,
    )
    db.add(row)
    _record_auth_event(
        db,
        kind="staff_create",
        status="ok",
        email=user.email,
        user_id=user.id,
        detail=f"created staff {email}",
    )
    db.commit()
    db.refresh(row)
    return PlatformUserOut(
        id=row.id,
        email=row.email,
        full_name=row.full_name,
        role=row.role,
        active=row.active,
        created_at=row.created_at,
    )


@router.patch("/platform/staff/{staff_id}", response_model=PlatformUserOut)
def update_platform_staff(
    staff_id: int,
    body: PlatformStaffUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformUserOut:
    row = db.get(User, staff_id)
    if row is None or row.role != PLATFORM_ADMIN:
        raise HTTPException(status_code=404, detail="Staff account not found")
    data = body.model_dump(exclude_unset=True)
    if "full_name" in data and data["full_name"] is not None:
        row.full_name = data["full_name"].strip()
    if "active" in data and data["active"] is not None:
        if staff_id == user.id and not data["active"]:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own staff account")
        row.active = bool(data["active"])
        if not row.active:
            _bump_token_version(row)
            _revoke_refresh_tokens(db, row.id)
    if "password" in data and data["password"]:
        row.password_hash = hash_password(data["password"])
        _bump_token_version(row)
        _revoke_refresh_tokens(db, row.id)
    row.updated_at = datetime.now(timezone.utc)
    _record_auth_event(
        db,
        kind="staff_update",
        status="ok",
        email=user.email,
        user_id=user.id,
        detail=f"updated staff_id={row.id}",
    )
    db.commit()
    db.refresh(row)
    return PlatformUserOut(
        id=row.id,
        email=row.email,
        full_name=row.full_name,
        role=row.role,
        active=row.active,
        created_at=row.created_at,
    )


@router.get("/platform/users", response_model=PlatformUserListOut)
def platform_list_all_users(
    q: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformUserListOut:
    query = db.query(User).filter(User.role != PLATFORM_ADMIN)
    term = (q or "").strip().lower()
    if term:
        like = f"%{term}%"
        query = query.filter(or_(User.email.ilike(like), User.full_name.ilike(like)))
    rows = query.order_by(User.created_at.desc()).limit(500).all()
    tenant_ids = {r.tenant_id for r in rows if r.tenant_id}
    names = {
        t.id: t.name for t in db.query(Tenant).filter(Tenant.id.in_(list(tenant_ids))).all()
    } if tenant_ids else {}
    return PlatformUserListOut(
        items=[
            PlatformUserOut(
                id=r.id,
                email=r.email,
                full_name=r.full_name,
                role=r.role,
                active=r.active,
                tenant_id=r.tenant_id,
                tenant_name=names.get(r.tenant_id or -1, ""),
                created_at=r.created_at,
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.get("/platform/data/summary", response_model=PlatformDataSummaryOut)
def platform_data_summary(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformDataSummaryOut:
    return PlatformDataSummaryOut(
        tenants=db.query(Tenant).count(),
        users=db.query(User).filter(User.role != PLATFORM_ADMIN).count(),
        staff=db.query(User).filter(User.role == PLATFORM_ADMIN).count(),
        equipment=db.query(EquipmentCache).count(),
        calibrations=db.query(CalibrationRecord).count(),
        email_audits=db.query(EmailAuditLog).count(),
        auth_events=db.query(AuthEvent).count(),
        notifications=db.query(AppNotification).count(),
        system_smtp_ready=is_system_smtp_ready(db),
    )


def _platform_smtp_out(db: Session) -> PlatformSmtpOut:
    env_ready = get_settings().system_smtp_ready
    row = get_or_create_platform_settings(db)
    db_configured = platform_smtp_configured(row)
    if db_configured:
        return PlatformSmtpOut(
            configured=True,
            source="db",
            smtp_host=row.smtp_host,
            smtp_port=int(row.smtp_port or 587),
            smtp_username=row.smtp_username,
            smtp_use_tls=bool(row.smtp_use_tls),
            smtp_from_email=row.smtp_from_email,
            smtp_from_name=row.smtp_from_name or "TrueGage",
            has_password=True,
            last_error=row.smtp_last_error,
            env_fallback_ready=env_ready,
        )
    if env_ready:
        s = get_settings()
        return PlatformSmtpOut(
            configured=True,
            source="env",
            smtp_host=s.system_smtp_host or None,
            smtp_port=int(s.system_smtp_port or 587),
            smtp_username=s.system_smtp_username or None,
            smtp_use_tls=bool(s.system_smtp_use_tls),
            smtp_from_email=s.system_smtp_from_email or None,
            smtp_from_name=s.system_smtp_from_name or "TrueGage",
            has_password=True,
            last_error=None,
            env_fallback_ready=True,
        )
    return PlatformSmtpOut(
        configured=False,
        source="none",
        smtp_host=row.smtp_host,
        smtp_port=int(row.smtp_port or 587),
        smtp_username=row.smtp_username,
        smtp_use_tls=bool(row.smtp_use_tls),
        smtp_from_email=row.smtp_from_email,
        smtp_from_name=row.smtp_from_name or "TrueGage",
        has_password=bool(row.smtp_password_encrypted),
        last_error=row.smtp_last_error,
        env_fallback_ready=False,
    )


@router.get("/platform/smtp", response_model=PlatformSmtpOut)
def get_platform_smtp(
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformSmtpOut:
    return _platform_smtp_out(db)


@router.put("/platform/smtp", response_model=PlatformSmtpOut)
def save_platform_smtp(
    body: PlatformSmtpIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformSmtpOut:
    row = get_or_create_platform_settings(db)
    from_email = body.smtp_from_email.strip().lower()
    if "@" not in from_email or "." not in from_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid From email address")
    row.smtp_host = validate_smtp_host(body.smtp_host)
    row.smtp_port = body.smtp_port
    row.smtp_username = (body.smtp_username or "").strip() or None
    row.smtp_use_tls = True if get_settings().is_production else bool(body.smtp_use_tls)
    row.smtp_from_email = from_email
    row.smtp_from_name = (body.smtp_from_name or "TrueGage").strip() or "TrueGage"
    if body.smtp_password and body.smtp_password.strip():
        row.smtp_password_encrypted = encrypt_secret(body.smtp_password.strip())
    elif not row.smtp_password_encrypted:
        raise HTTPException(
            status_code=400,
            detail="SMTP password is required the first time you save",
        )
    row.smtp_last_error = None
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    logger.info("platform.smtp_saved by=%s", user.email)
    return _platform_smtp_out(db)


@router.post("/platform/smtp/test", response_model=PlatformSmtpTestOut)
def test_platform_smtp(
    body: PlatformSmtpTestIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformSmtpTestOut:
    to_email = body.to_email.strip().lower()
    if "@" not in to_email:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    try:
        config = load_system_smtp_config(db)
    except EmailError as exc:
        row = get_or_create_platform_settings(db)
        row.smtp_last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    msg = build_message(
        config=config,
        to_email=to_email,
        to_name="TrueGage Staff",
        subject="TrueGage platform SMTP check",
        text_body=(
            "This is a test message from the TrueGage staff console.\n"
            "Platform SMTP is working.\n"
        ),
        html_body=(
            "<p>This is a test message from the <strong>TrueGage</strong> staff console.</p>"
            "<p>Platform SMTP is working.</p>"
        ),
    )
    try:
        send_message(config, msg)
    except EmailError as exc:
        row = get_or_create_platform_settings(db)
        row.smtp_last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = get_or_create_platform_settings(db)
    row.smtp_last_error = None
    db.commit()
    return PlatformSmtpTestOut(ok=True, message=f"Test email sent to {to_email}")


_PLATFORM_TABLES = {
    "tenants": Tenant,
    "users": User,
    "equipment": EquipmentCache,
    "calibrations": CalibrationRecord,
    "email_audits": EmailAuditLog,
    "auth_events": AuthEvent,
    "notifications": AppNotification,
}

_REDACT_COLS = {
    "password_hash",
    "token_hash",
    "code_hash",
    "smtp_password_encrypted",
    "odoo_api_key_encrypted",
    "raw_payload",
}


@router.get("/platform/data/{table}", response_model=PlatformDataTableOut)
def platform_data_table(
    table: str,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformDataTableOut:
    key = (table or "").strip().lower()
    model = _PLATFORM_TABLES.get(key)
    if model is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown table. Allowed: {', '.join(sorted(_PLATFORM_TABLES))}",
        )
    lim = max(1, min(limit, 100))
    off = max(0, offset)
    total = db.query(model).count()
    rows = (
        db.query(model)
        .order_by(model.id.desc())
        .offset(off)
        .limit(lim)
        .all()
    )
    columns: list[str] = []
    out_rows: list[dict] = []
    for row in rows:
        data: dict = {}
        for col in row.__table__.columns:  # type: ignore[attr-defined]
            name = col.name
            if name in _REDACT_COLS:
                continue
            if name not in columns:
                columns.append(name)
            val = getattr(row, name)
            if hasattr(val, "isoformat"):
                val = val.isoformat()
            data[name] = val
        out_rows.append(data)
    if not columns:
        # Empty page — still expose column names from the model
        columns = [c.name for c in model.__table__.columns if c.name not in _REDACT_COLS]  # type: ignore[attr-defined]
    return PlatformDataTableOut(
        table=key,
        columns=columns,
        rows=out_rows,
        total=total,
        limit=lim,
        offset=off,
    )


@router.get("/platform/tenants/{tenant_id}/users", response_model=UserListOut)
def platform_list_tenant_users(
    tenant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> UserListOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    rows = (
        db.query(User)
        .filter(User.tenant_id == tenant_id)
        .order_by(User.full_name.asc(), User.email.asc())
        .all()
    )
    return UserListOut(items=[user_to_out(r) for r in rows], total=len(rows))


@router.get("/platform/tenants/{tenant_id}/summary", response_model=PlatformTenantSummaryOut)
def platform_tenant_summary(
    tenant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformTenantSummaryOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Company not found")
    settings_row = db.query(AppSettings).filter(AppSettings.tenant_id == tenant_id).one_or_none()
    users = db.query(User).filter(User.tenant_id == tenant_id).all()
    active_users = sum(1 for u in users if u.active)
    admins = sum(1 for u in users if u.role == "admin" and u.active)
    equipment_count = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == tenant_id).count()
    overdue_count = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id == tenant_id, EquipmentCache.status == "overdue")
        .count()
    )
    calibration_count = (
        db.query(CalibrationRecord).filter(CalibrationRecord.tenant_id == tenant_id).count()
    )
    since_7d = datetime.now(timezone.utc) - timedelta(days=7)
    email_rows = (
        db.query(EmailAuditLog)
        .filter(EmailAuditLog.tenant_id == tenant_id, EmailAuditLog.created_at >= since_7d)
        .all()
    )
    email_sent = sum(1 for r in email_rows if r.status == "sent")
    email_failed = sum(1 for r in email_rows if r.status != "sent")
    last_auth = (
        db.query(AuthEvent)
        .filter(AuthEvent.tenant_id == tenant_id)
        .order_by(AuthEvent.created_at.desc())
        .first()
    )
    last_email = (
        db.query(EmailAuditLog)
        .filter(EmailAuditLog.tenant_id == tenant_id)
        .order_by(EmailAuditLog.created_at.desc())
        .first()
    )
    smtp_ok = smtp_configured(settings_row) if settings_row else False
    odoo_ok = _odoo_configured(settings_row)
    sys_smtp = is_system_smtp_ready(db)
    storage_on = bool(getattr(tenant, "storage_enabled", False))
    storage_used = tenant_storage_usage(db, tenant_id)
    storage_quota = int(get_settings().certificate_tenant_quota_bytes) if storage_on else 0
    cert_count = tenant_certificate_count(db, tenant_id)
    checklist = [
        ChecklistItemOut(id="active", label="Company active", done=bool(tenant.active)),
        ChecklistItemOut(id="admin", label="At least one active admin", done=admins > 0),
        ChecklistItemOut(id="org_profile", label="Company profile filled", done=bool((settings_row.company_name if settings_row else "").strip())),
        ChecklistItemOut(id="smtp", label="Company SMTP configured", done=smtp_ok),
        ChecklistItemOut(id="odoo", label="Odoo connected", done=odoo_ok),
        ChecklistItemOut(id="equipment", label="Equipment in workspace", done=equipment_count > 0),
        ChecklistItemOut(id="storage", label="Certificate vault enabled", done=storage_on),
        ChecklistItemOut(id="platform_smtp", label="Platform SMTP ready (welcome emails)", done=sys_smtp),
    ]
    return PlatformTenantSummaryOut(
        tenant_id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        active=bool(tenant.active),
        storage_enabled=storage_on,
        storage_used_bytes=storage_used if storage_on else 0,
        storage_quota_bytes=storage_quota,
        certificate_count=cert_count,
        user_count=len(users),
        active_user_count=active_users,
        admin_count=admins,
        equipment_count=equipment_count,
        overdue_count=overdue_count,
        calibration_count=calibration_count,
        email_7d_sent=email_sent,
        email_7d_failed=email_failed,
        smtp_configured=smtp_ok,
        odoo_configured=odoo_ok,
        system_smtp_ready=sys_smtp,
        timezone=(settings_row.timezone if settings_row else None) or "UTC",
        company_name=(settings_row.company_name if settings_row else "") or tenant.name,
        industry=(settings_row.industry if settings_row else "") or "",
        address=(settings_row.address if settings_row else "") or "",
        accent_color=(settings_row.accent_color if settings_row else None) or "#0f766e",
        odoo_url=(settings_row.odoo_url if settings_row else None),
        odoo_connected=bool(settings_row.odoo_connected) if settings_row else False,
        odoo_last_error=(settings_row.odoo_last_error if settings_row else None),
        smtp_host=(settings_row.smtp_host if settings_row else None),
        smtp_from_email=(settings_row.smtp_from_email if settings_row else None),
        last_auth_at=last_auth.created_at if last_auth else None,
        last_email_at=last_email.created_at if last_email else None,
        checklist=checklist,
    )


@router.post("/platform/tenants/{tenant_id}/users", response_model=UserOut, status_code=201)
def platform_create_tenant_user(
    tenant_id: int,
    body: AdminUserCreateIn,
    db: Session = Depends(get_db),
    staff: User = Depends(require_platform_admin),
) -> UserOut:
    if not user_can_access_tenant(db, staff, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    if db.get(Tenant, tenant_id) is None:
        raise HTTPException(status_code=404, detail="Company not found")
    email = _normalize_email(body.email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    existing = db.query(User).filter(User.email == email).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    full_name = body.full_name.strip() or email.split("@")[0]
    row = User(
        tenant_id=tenant_id,
        email=email,
        password_hash=hash_password(body.password),
        full_name=full_name,
        role=body.role,
        job_title=body.job_title.strip(),
        department=body.department.strip(),
        active=True,
    )
    db.add(row)
    _record_auth_event(
        db,
        kind="staff_create_user",
        status="ok",
        email=staff.email,
        user_id=staff.id,
        tenant_id=tenant_id,
        detail=f"created {email} role={body.role}",
    )
    db.commit()
    db.refresh(row)
    return user_to_out(row)


@router.patch("/platform/tenants/{tenant_id}/users/{user_id}", response_model=UserOut)
def platform_update_tenant_user(
    tenant_id: int,
    user_id: int,
    body: AdminUserUpdateIn,
    db: Session = Depends(get_db),
    staff: User = Depends(require_platform_admin),
) -> UserOut:
    if not user_can_access_tenant(db, staff, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    row = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if row.role == PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot edit platform admin via company tools")
    data = body.model_dump(exclude_unset=True)
    if "full_name" in data and data["full_name"] is not None:
        row.full_name = data["full_name"].strip()
    if "email" in data and data["email"] is not None:
        email = _normalize_email(data["email"])
        other = db.query(User).filter(User.email == email, User.id != row.id).one_or_none()
        if other is not None:
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        row.email = email
    if "role" in data and data["role"] is not None:
        if data["role"] != "admin" and row.role == "admin":
            other_admins = (
                db.query(User)
                .filter(
                    User.tenant_id == tenant_id,
                    User.role == "admin",
                    User.active.is_(True),
                    User.id != row.id,
                )
                .count()
            )
            if other_admins == 0:
                raise HTTPException(status_code=400, detail="Company must keep at least one active admin")
        row.role = data["role"]
    if "job_title" in data and data["job_title"] is not None:
        row.job_title = data["job_title"].strip()
    if "department" in data and data["department"] is not None:
        row.department = data["department"].strip()
    if "active" in data and data["active"] is not None:
        if not data["active"] and row.role == "admin":
            other_admins = (
                db.query(User)
                .filter(
                    User.tenant_id == tenant_id,
                    User.role == "admin",
                    User.active.is_(True),
                    User.id != row.id,
                )
                .count()
            )
            if other_admins == 0:
                raise HTTPException(status_code=400, detail="Company must keep at least one active admin")
        row.active = bool(data["active"])
        if not row.active:
            _bump_token_version(row)
            _revoke_refresh_tokens(db, row.id)
    if "password" in data and data["password"]:
        row.password_hash = hash_password(data["password"])
        _bump_token_version(row)
        _revoke_refresh_tokens(db, row.id)
    row.updated_at = datetime.now(timezone.utc)
    _record_auth_event(
        db,
        kind="staff_update_user",
        status="ok",
        email=staff.email,
        user_id=staff.id,
        tenant_id=tenant_id,
        detail=f"updated user_id={row.id}",
    )
    db.commit()
    db.refresh(row)
    return user_to_out(row)


@router.post("/platform/tenants/{tenant_id}/users/{user_id}/revoke-sessions", response_model=UserOut)
def platform_revoke_user_sessions(
    tenant_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    staff: User = Depends(require_platform_admin),
) -> UserOut:
    if not user_can_access_tenant(db, staff, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    row = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if row.role == PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot revoke platform admin this way")
    _bump_token_version(row)
    _revoke_refresh_tokens(db, row.id)
    row.updated_at = datetime.now(timezone.utc)
    _record_auth_event(
        db,
        kind="revoke_sessions",
        status="ok",
        email=staff.email,
        user_id=staff.id,
        tenant_id=tenant_id,
        detail=f"revoked user_id={row.id}",
    )
    db.commit()
    db.refresh(row)
    return user_to_out(row)


@router.post("/platform/tenants/{tenant_id}/welcome-email", response_model=PlatformEmailQueueItem)
def platform_resend_welcome_email(
    tenant_id: int,
    body: WelcomeEmailIn,
    db: Session = Depends(get_db),
    staff: User = Depends(require_platform_admin),
) -> PlatformEmailQueueItem:
    if not user_can_access_tenant(db, staff, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Company not found")
    if body.user_id is not None:
        target = (
            db.query(User)
            .filter(User.id == body.user_id, User.tenant_id == tenant_id)
            .one_or_none()
        )
    else:
        target = (
            db.query(User)
            .filter(User.tenant_id == tenant_id, User.role == "admin", User.active.is_(True))
            .order_by(User.id.asc())
            .first()
        )
    if target is None:
        raise HTTPException(status_code=404, detail="Target admin user not found")
    if target.role == PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot send welcome to platform admin")
    password = body.password.strip()
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    target.password_hash = hash_password(password)
    _bump_token_version(target)
    _revoke_refresh_tokens(db, target.id)
    target.updated_at = datetime.now(timezone.utc)

    login_url = f"{get_settings().app_public_url.rstrip('/')}/auth/login"
    welcome_status = "sent"
    welcome_error = ""
    try:
        send_company_welcome_email(
            to_email=target.email,
            to_name=target.full_name or target.email,
            company_name=tenant.name,
            temp_password=password,
            login_url=login_url,
            db=db,
        )
    except EmailError as exc:
        welcome_status = "failed"
        welcome_error = str(exc)
    except Exception as exc:  # noqa: BLE001
        welcome_status = "failed"
        welcome_error = str(exc)

    audit = EmailAuditLog(
        tenant_id=tenant_id,
        kind="welcome",
        subject=f"Welcome to TrueGage — {tenant.name} workspace is ready",
        to_email=target.email,
        to_name=target.full_name or "",
        status=welcome_status,
        error=welcome_error or None,
        equipment_count=0,
        detail="platform welcome resend",
        org_member=True,
    )
    db.add(audit)
    _record_auth_event(
        db,
        kind="welcome_email",
        status="ok" if welcome_status == "sent" else "failed",
        email=target.email,
        user_id=staff.id,
        tenant_id=tenant_id,
        detail=welcome_error or "resent",
    )
    db.commit()
    db.refresh(audit)
    return PlatformEmailQueueItem(
        id=audit.id,
        kind=audit.kind,
        subject=audit.subject,
        to_email=audit.to_email,
        to_name=audit.to_name,
        status=audit.status,
        error=audit.error,
        equipment_count=audit.equipment_count,
        detail=audit.detail,
        org_member=bool(audit.org_member),
        created_at=audit.created_at,
        tenant_id=tenant_id,
        tenant_name=tenant.name,
    )


@router.patch("/platform/tenants/{tenant_id}/org", response_model=OrgProfileOut)
def platform_update_tenant_org(
    tenant_id: int,
    body: OrgProfileIn,
    db: Session = Depends(get_db),
    staff: User = Depends(require_platform_admin),
) -> OrgProfileOut:
    if not user_can_access_tenant(db, staff, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Company not found")
    settings_row = db.query(AppSettings).filter(AppSettings.tenant_id == tenant_id).one_or_none()
    if settings_row is None:
        settings_row = AppSettings(tenant_id=tenant_id)
        db.add(settings_row)
        db.flush()
    company_name = body.company_name.strip() or tenant.name
    settings_row.company_name = company_name
    settings_row.industry = body.industry.strip()
    settings_row.address = body.address.strip()
    settings_row.timezone = body.timezone.strip() or "UTC"
    settings_row.accent_color = body.accent_color.strip() or "#0f766e"
    tenant.name = company_name
    tenant.updated_at = datetime.now(timezone.utc)
    _record_auth_event(
        db,
        kind="staff_update_org",
        status="ok",
        email=staff.email,
        user_id=staff.id,
        tenant_id=tenant_id,
        detail="org profile updated",
    )
    db.commit()
    db.refresh(settings_row)
    return org_to_out(settings_row)


@router.get("/platform/tenants/{tenant_id}/email-history", response_model=EmailAuditListOut)
def platform_tenant_email_history(
    tenant_id: int,
    status: str = "",
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> EmailAuditListOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    lim = max(1, min(limit, 100))
    q = db.query(EmailAuditLog).filter(EmailAuditLog.tenant_id == tenant_id)
    st = (status or "").strip().lower()
    if st in ("sent", "failed"):
        if st == "sent":
            q = q.filter(EmailAuditLog.status == "sent")
        else:
            q = q.filter(EmailAuditLog.status != "sent")
    rows = q.order_by(EmailAuditLog.created_at.desc(), EmailAuditLog.id.desc()).limit(lim).all()
    return EmailAuditListOut(items=[email_audit_to_out(r) for r in rows], total=len(rows))


@router.get(
    "/platform/tenants/{tenant_id}/equipment",
    response_model=PlatformTenantEquipmentListOut,
)
def platform_tenant_equipment(
    tenant_id: int,
    status: str = "",
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformTenantEquipmentListOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    lim = max(1, min(limit, 200))
    q = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == tenant_id)
    st = (status or "").strip().lower()
    if st:
        q = q.filter(EquipmentCache.status == st)
    rows = q.order_by(EquipmentCache.name.asc()).limit(lim).all()
    return PlatformTenantEquipmentListOut(
        items=[
            PlatformTenantEquipmentOut(
                id=r.public_id,
                tag=r.tag or "",
                name=r.name or "",
                status=r.status or "",
                department=r.department or "",
                location=r.location or "",
                next_calibration=r.next_calibration.isoformat() if r.next_calibration else None,
                last_calibration=r.last_calibration.isoformat() if r.last_calibration else None,
                owner=r.owner or "",
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.get("/platform/tenants/{tenant_id}/activity", response_model=PlatformActivityOut)
def platform_tenant_activity(
    tenant_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformActivityOut:
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    tenant = db.get(Tenant, tenant_id)
    tname = tenant.name if tenant else ""
    lim = max(1, min(limit, 100))
    items: list[PlatformActivityItem] = []
    for row in (
        db.query(AuthEvent)
        .filter(AuthEvent.tenant_id == tenant_id)
        .order_by(AuthEvent.created_at.desc())
        .limit(lim)
        .all()
    ):
        items.append(
            PlatformActivityItem(
                id=f"auth-{row.id}",
                kind=row.kind,
                title=row.kind.replace("_", " ").title(),
                detail=row.detail or row.email,
                status=row.status,
                tenant_id=tenant_id,
                tenant_name=tname,
                created_at=row.created_at,
            )
        )
    for row in (
        db.query(EmailAuditLog)
        .filter(EmailAuditLog.tenant_id == tenant_id)
        .order_by(EmailAuditLog.created_at.desc())
        .limit(lim)
        .all()
    ):
        items.append(
            PlatformActivityItem(
                id=f"email-{row.id}",
                kind=f"email_{row.kind}",
                title=row.subject or row.kind,
                detail=f"{row.to_name} <{row.to_email}>".strip(),
                status=row.status,
                tenant_id=tenant_id,
                tenant_name=tname,
                created_at=row.created_at,
            )
        )
    cert_titles = {
        "certificate.uploaded": "Uploaded certificate",
        "certificate.viewed": "Viewed certificate",
        "certificate.deleted": "Deleted certificate",
    }
    for row in (
        db.query(AuditEvent)
        .filter(AuditEvent.tenant_id == tenant_id, AuditEvent.action.like("certificate.%"))
        .order_by(AuditEvent.created_at.desc())
        .limit(lim)
        .all()
    ):
        items.append(
            PlatformActivityItem(
                id=f"audit-{row.id}",
                kind=row.action,
                title=cert_titles.get(row.action, row.action.replace(".", " ").title()),
                detail=(row.detail or row.target_name or row.user_name or "").strip(),
                status="ok",
                tenant_id=tenant_id,
                tenant_name=tname,
                created_at=row.created_at,
            )
        )
    items.sort(key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    items = items[:lim]
    return PlatformActivityOut(items=items, total=len(items))


@router.get("/platform/email-queue", response_model=PlatformEmailQueueOut)
def platform_email_queue(
    status: str = "",
    kind: str = "",
    limit: int = 80,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> PlatformEmailQueueOut:
    lim = max(1, min(limit, 200))
    q = db.query(EmailAuditLog)
    st = (status or "").strip().lower()
    if st == "sent":
        q = q.filter(EmailAuditLog.status == "sent")
    elif st == "failed":
        q = q.filter(EmailAuditLog.status != "sent")
    kd = (kind or "").strip().lower()
    if kd:
        q = q.filter(EmailAuditLog.kind == kd)
    rows = q.order_by(EmailAuditLog.created_at.desc(), EmailAuditLog.id.desc()).limit(lim).all()
    tenant_ids = {r.tenant_id for r in rows}
    names = {
        t.id: t.name for t in db.query(Tenant).filter(Tenant.id.in_(list(tenant_ids))).all()
    } if tenant_ids else {}
    return PlatformEmailQueueOut(
        items=[
            PlatformEmailQueueItem(
                id=r.id,
                kind=r.kind,
                subject=r.subject,
                to_email=r.to_email,
                to_name=r.to_name,
                status=r.status,
                error=r.error,
                equipment_count=r.equipment_count,
                detail=r.detail,
                org_member=bool(r.org_member),
                created_at=r.created_at,
                tenant_id=r.tenant_id,
                tenant_name=names.get(r.tenant_id, ""),
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.post("/tenants/{tenant_id}/users/{user_id}/force-password", response_model=UserOut)
def force_password(
    tenant_id: int,
    user_id: int,
    body: ForcePasswordIn,
    db: Session = Depends(get_db),
    staff: User = Depends(require_platform_admin),
) -> UserOut:
    if not user_can_access_tenant(db, staff, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    row = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if row.role == PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot reset another platform admin this way")
    row.password_hash = hash_password(body.password)
    _bump_token_version(row)
    _revoke_refresh_tokens(db, row.id)
    row.updated_at = datetime.now(timezone.utc)
    _record_auth_event(
        db,
        kind="force_password",
        status="ok",
        email=row.email,
        user_id=staff.id,
        tenant_id=tenant_id,
        detail=f"reset user_id={row.id}",
    )
    db.commit()
    db.refresh(row)
    return user_to_out(row)


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
    if "slug" in data and data["slug"] is not None:
        cleaned = _slugify(str(data["slug"]))
        if len(cleaned) < 2:
            raise HTTPException(status_code=400, detail="Slug must be at least 2 characters")
        taken = (
            db.query(Tenant)
            .filter(Tenant.slug == cleaned, Tenant.id != tenant_id)
            .one_or_none()
        )
        if taken is not None:
            raise HTTPException(status_code=400, detail="That slug is already in use")
        if cleaned != row.slug:
            old = row.slug
            row.slug = cleaned
            _record_auth_event(
                db,
                kind="tenant_slug",
                status="ok",
                email=user.email,
                user_id=user.id,
                tenant_id=tenant_id,
                detail=f"{old}->{cleaned}",
            )
    if "active" in data and data["active"] is not None:
        row.active = bool(data["active"])
        _record_auth_event(
            db,
            kind="tenant_suspend" if not row.active else "tenant_activate",
            status="ok",
            email=user.email,
            user_id=user.id,
            tenant_id=tenant_id,
            detail=f"active={row.active}",
        )
    if "storage_enabled" in data and data["storage_enabled"] is not None:
        row.storage_enabled = bool(data["storage_enabled"])
        _record_auth_event(
            db,
            kind="tenant_storage",
            status="ok",
            email=user.email,
            user_id=user.id,
            tenant_id=tenant_id,
            detail=f"storage_enabled={row.storage_enabled}",
        )
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return tenant_to_detail(row, db)


@router.delete("/tenants/{tenant_id}", status_code=204)
def delete_tenant(
    tenant_id: int,
    confirm_slug: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> Response:
    """Permanently delete a company and its workspace data. Requires confirm_slug match."""
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    row = db.get(Tenant, tenant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Company not found")
    if (confirm_slug or "").strip() != row.slug:
        raise HTTPException(
            status_code=400,
            detail="Confirmation slug does not match. Type the company slug exactly to delete.",
        )

    slug = row.slug
    name = row.name
    try:
        r2_storage.purge_tenant_prefix(tenant_id=tenant_id)
    except Exception:  # noqa: BLE001
        logger.warning("tenant_delete_r2_purge_failed tenant_id=%s", tenant_id, exc_info=True)

    org_users = db.query(User).filter(User.tenant_id == tenant_id).all()
    for u in org_users:
        if u.role == PLATFORM_ADMIN:
            u.tenant_id = None
        else:
            db.delete(u)

    db.query(TenantMembership).filter(TenantMembership.tenant_id == tenant_id).delete(
        synchronize_session=False
    )
    db.delete(row)
    _record_auth_event(
        db,
        kind="tenant_delete",
        status="ok",
        email=user.email,
        user_id=user.id,
        tenant_id=None,
        detail=f"deleted {name} ({slug})",
    )
    db.commit()
    logger.info("tenant.deleted id=%s slug=%s by=%s", tenant_id, slug, user.email)
    return Response(status_code=204)


@router.post("/tenants", response_model=TenantOut, status_code=201)
def create_tenant(
    body: TenantCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> TenantOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name is required")
    admin_email = (body.admin_email or "").strip()
    admin_password = (body.admin_password or "").strip()
    if not admin_email or not admin_password:
        raise HTTPException(
            status_code=400,
            detail="Company admin email and password are required for onboarding",
        )
    email = _normalize_email(admin_email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid admin email address")
    if len(admin_password) < 12:
        raise HTTPException(status_code=400, detail="Admin password must be at least 12 characters")
    existing = db.query(User).filter(User.email == email).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

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

    _record_auth_event(
        db,
        kind="tenant_onboard",
        status="ok",
        email=user.email,
        user_id=user.id,
        tenant_id=tenant.id,
        detail=f"onboarded {name}; admin={email}",
    )

    welcome_status = "skipped"
    welcome_error = ""
    if body.send_welcome_email:
        app_url = get_settings().app_public_url.rstrip("/")
        login_url = f"{app_url}/auth/login"
        try:
            send_company_welcome_email(
                to_email=email,
                to_name=full_name,
                company_name=name,
                temp_password=admin_password,
                login_url=login_url,
                db=db,
            )
            welcome_status = "sent"
        except EmailError as exc:
            welcome_status = "failed"
            welcome_error = str(exc)
        except Exception as exc:  # noqa: BLE001
            welcome_status = "failed"
            welcome_error = str(exc)
        db.add(
            EmailAuditLog(
                tenant_id=tenant.id,
                kind="welcome",
                subject=f"Welcome to TrueGage — {name} workspace is ready",
                to_email=email,
                to_name=full_name,
                status=welcome_status if welcome_status != "skipped" else "failed",
                error=welcome_error or None,
                equipment_count=0,
                detail="platform onboarding welcome",
                org_member=True,
            )
        )
        _record_auth_event(
            db,
            kind="welcome_email",
            status="ok" if welcome_status == "sent" else "failed",
            email=email,
            user_id=user.id,
            tenant_id=tenant.id,
            detail=welcome_error or welcome_status,
        )

    db.commit()
    db.refresh(tenant)
    if welcome_status == "failed":
        logger.warning(
            "onboard.welcome_email_failed tenant_id=%s email=%s err=%s",
            tenant.id,
            email,
            welcome_error,
        )
    return tenant_to_out(tenant, db)


@router.post("/tenants/{tenant_id}/handoff", response_model=HandoffCreateOut)
def create_handoff_code(
    tenant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> HandoffCreateOut:
    """Issue a one-time short-lived code for opening a company workspace (no token in URL)."""
    if not user_can_access_tenant(db, user, tenant_id):
        raise HTTPException(status_code=404, detail="Company not found")
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or not tenant.active:
        raise HTTPException(status_code=400, detail="Workspace not found or inactive")
    settings = get_settings()
    raw = new_opaque_token()
    row = HandoffCode(
        code_hash=hash_opaque_token(raw),
        user_id=user.id,
        tenant_id=tenant_id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.handoff_code_ttl_seconds),
        used=False,
    )
    db.add(row)
    _record_auth_event(
        db,
        kind="handoff",
        status="ok",
        email=user.email,
        user_id=user.id,
        tenant_id=tenant_id,
        detail="handoff code issued",
    )
    db.commit()
    logger.info("auth.handoff_created user_id=%s tenant_id=%s", user.id, tenant_id)
    return HandoffCreateOut(code=raw, expires_in=settings.handoff_code_ttl_seconds)


@router.post("/auth/handoff/exchange", response_model=AuthTokenOut)
def exchange_handoff_code(
    body: HandoffExchangeIn,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthTokenOut:
    settings = get_settings()
    ip = _client_ip(request)
    if not login_limiter.hit(
        f"handoff:{ip}",
        limit=settings.login_rate_limit_per_minute,
        window_seconds=60.0,
    ):
        logger.warning("auth.handoff_rate_limited ip=%s", ip)
        raise HTTPException(status_code=429, detail="Too many handoff attempts. Try again shortly.")

    code = body.code.strip()
    row = db.query(HandoffCode).filter(HandoffCode.code_hash == hash_opaque_token(code)).one_or_none()
    now = datetime.now(timezone.utc)
    if row is None or row.used:
        raise HTTPException(status_code=400, detail="Invalid or already used handoff code")
    exp = row.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now:
        raise HTTPException(status_code=400, detail="Handoff code expired — open the company again")
    user = db.get(User, row.user_id)
    if user is None or not user.active or user.role != PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Invalid handoff code")
    row.used = True
    db.add(row)
    logger.info("auth.handoff_exchanged user_id=%s tenant_id=%s", user.id, row.tenant_id)
    return _issue_token(db, user, row.tenant_id)


@router.post("/tenants/{tenant_id}/switch", response_model=AuthTokenOut)
def switch_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_platform_admin),
) -> AuthTokenOut:
    """Legacy switch — prefer /tenants/{id}/handoff for browser open."""
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
    if len(body.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
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
    db.flush()

    if body.send_credentials:
        _send_user_credentials_email(
            db,
            tenant_id=ctx.tenant_id,
            user=user,
            password=body.password,
        )

    db.commit()
    db.refresh(user)
    return user_to_out(user)


def _send_user_credentials_email(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    password: str,
) -> None:
    settings_row = get_or_create_settings(db, tenant_id)
    if not smtp_configured(settings_row):
        raise HTTPException(
            status_code=400,
            detail="Configure Email Delivery (SMTP) before sending login credentials",
        )
    tenant = db.get(Tenant, tenant_id)
    company = (settings_row.company_name or "").strip() or (tenant.name if tenant else "TrueGage")
    login_url = f"{get_settings().app_public_url.rstrip('/')}/auth/login"
    role_label = (user.role or "").replace("_", " ").title()
    try:
        config = load_smtp_config(settings_row)
        send_login_credentials_email(
            config,
            to_email=user.email,
            to_name=user.full_name or user.email,
            company_name=company,
            temp_password=password,
            login_url=login_url,
            role_label=role_label,
        )
        status = "sent"
        err: str | None = None
    except EmailError as exc:
        status = "failed"
        err = str(exc)
    except Exception as exc:  # noqa: BLE001
        status = "failed"
        err = str(exc)
    log_email_send(
        db,
        tenant_id=tenant_id,
        kind="credentials",
        subject=f"Your TrueGage login — {company}",
        to_email=user.email,
        to_name=user.full_name or "",
        status=status,
        error=err,
        detail="org admin credentials email",
    )
    if status != "sent":
        raise HTTPException(
            status_code=502,
            detail=err or "Could not send credentials email",
        )


@router.post("/users/{user_id}/revoke-sessions", response_model=UserOut)
def revoke_user_sessions(
    user_id: int,
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
    if row.role == PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot revoke platform admin this way")
    _bump_token_version(row)
    _revoke_refresh_tokens(db, row.id)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return user_to_out(row)


@router.post("/users/{user_id}/send-credentials", response_model=UserOut)
def send_user_credentials(
    user_id: int,
    body: SendCredentialsIn,
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
    if row.role == PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot send credentials to platform admin")
    password = body.password.strip()
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    row.password_hash = hash_password(password)
    _bump_token_version(row)
    _revoke_refresh_tokens(db, row.id)
    row.updated_at = datetime.now(timezone.utc)
    _send_user_credentials_email(db, tenant_id=ctx.tenant_id, user=row, password=password)
    db.commit()
    db.refresh(row)
    return user_to_out(row)


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
            if len(pw) < 6:
                raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
            row.password_hash = hash_password(pw)
            _bump_token_version(row)
            _revoke_refresh_tokens(db, row.id)
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
    if "active" in data and data["active"] is False:
        _bump_token_version(row)
        _revoke_refresh_tokens(db, row.id)
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
        _bump_token_version(row)
        _revoke_refresh_tokens(db, row.id)

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


@router.get("/org/taxonomy", response_model=OrgTaxonomyOut)
def get_org_taxonomy(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> OrgTaxonomyOut:
    return parse_taxonomy(get_or_create_settings(db, ctx.tenant_id))


@router.put("/org/taxonomy", response_model=OrgTaxonomyOut)
def save_org_taxonomy(
    body: OrgTaxonomyIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> OrgTaxonomyOut:
    row = get_or_create_settings(db, ctx.tenant_id)
    out = apply_taxonomy(row, body)
    db.commit()
    db.refresh(row)
    return out


@router.post("/org/taxonomy/terms", response_model=OrgTaxonomyOut)
def create_org_taxonomy_term(
    body: OrgTaxonomyTermIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_writer),
) -> OrgTaxonomyOut:
    """Add a department / category / location (QA, technician, admin)."""
    row = get_or_create_settings(db, ctx.tenant_id)
    out = add_taxonomy_term(row, body.kind.value, body.value)
    db.commit()
    db.refresh(row)
    return out


@router.patch("/org/taxonomy/terms", response_model=OrgTaxonomyOut)
def rename_org_taxonomy_term(
    body: OrgTaxonomyTermRenameIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_writer),
) -> OrgTaxonomyOut:
    """Rename a register term and update matching equipment (and user dept)."""
    row = get_or_create_settings(db, ctx.tenant_id)
    out = rename_taxonomy_term(
        db,
        ctx.tenant_id,
        row,
        body.kind.value,
        body.from_value,
        body.to_value,
    )
    db.commit()
    db.refresh(row)
    return out


@router.delete("/org/taxonomy/terms", response_model=OrgTaxonomyOut)
def delete_org_taxonomy_term(
    kind: str,
    value: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_writer),
) -> OrgTaxonomyOut:
    """Remove a term from the register lists (does not clear equipment fields)."""
    if kind not in {"departments", "categories", "locations"}:
        raise HTTPException(status_code=400, detail="Invalid kind")
    row = get_or_create_settings(db, ctx.tenant_id)
    out = remove_taxonomy_term(row, kind, value)
    db.commit()
    db.refresh(row)
    return out


@router.post("/org/taxonomy/import-equipment", response_model=OrgTaxonomyOut)
def import_taxonomy_from_equipment(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_writer),
) -> OrgTaxonomyOut:
    """Merge distinct department/category/location values from equipment into the registry."""
    row = get_or_create_settings(db, ctx.tenant_id)
    current = parse_taxonomy(row)
    seeded = seed_taxonomy_from_equipment(db, ctx.tenant_id)
    merged = OrgTaxonomyIn(
        departments=_normalize_taxonomy_terms([*current.departments, *seeded.departments]),
        categories=_normalize_taxonomy_terms([*current.categories, *seeded.categories]),
        locations=_normalize_taxonomy_terms([*current.locations, *seeded.locations]),
    )
    out = apply_taxonomy(row, merged)
    db.commit()
    db.refresh(row)
    return out


def _reminder_rules_out(db: Session, row: AppSettings) -> ReminderRulesOut:
    return ReminderRulesOut(
        remind_30d=bool(row.remind_30d),
        remind_14d=bool(row.remind_14d),
        remind_7d=bool(row.remind_7d),
        remind_1d=bool(row.remind_1d),
        remind_overdue_daily=bool(row.remind_overdue_daily),
        remind_weekly_digest=bool(row.remind_weekly_digest),
        reminder_hour_local=int(row.reminder_hour_local or 8),
        last_daily_run_at=last_daily_run_at(db, row.tenant_id),
    )


@router.get("/org/reminder-rules", response_model=ReminderRulesOut)
def get_reminder_rules(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> ReminderRulesOut:
    row = get_or_create_settings(db, ctx.tenant_id)
    return _reminder_rules_out(db, row)


@router.put("/org/reminder-rules", response_model=ReminderRulesOut)
def save_reminder_rules(
    body: ReminderRulesIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> ReminderRulesOut:
    row = get_or_create_settings(db, ctx.tenant_id)
    row.remind_30d = body.remind_30d
    row.remind_14d = body.remind_14d
    row.remind_7d = body.remind_7d
    row.remind_1d = body.remind_1d
    row.remind_overdue_daily = body.remind_overdue_daily
    row.remind_weekly_digest = body.remind_weekly_digest
    row.reminder_hour_local = int(body.reminder_hour_local)
    db.commit()
    db.refresh(row)
    return _reminder_rules_out(db, row)


@router.get("/org/reminder-logs", response_model=ReminderLogOut)
def list_reminder_logs(
    limit: int = 50,
    q: str | None = None,
    channel: str | None = None,
    kind: str | None = None,
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> ReminderLogOut:
    """Admin-only reminder engine job + aggregated delivery history."""
    lim = max(1, min(limit, 200))
    search = (q or "").strip().lower()
    channel_f = (channel or "").strip().lower()
    kind_f = (kind or "").strip().lower()
    status_f = (status or "").strip().lower()

    from_d: date | None = None
    to_d: date | None = None
    if from_date:
        try:
            from_d = date.fromisoformat(from_date[:10])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid from_date (use YYYY-MM-DD)") from exc
    if to_date:
        try:
            to_d = date.fromisoformat(to_date[:10])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid to_date (use YYYY-MM-DD)") from exc

    jobs_q = db.query(ReminderJob).filter(ReminderJob.tenant_id == ctx.tenant_id)
    dispatches_q = db.query(ReminderDispatch).filter(ReminderDispatch.tenant_id == ctx.tenant_id)
    if kind_f:
        dispatches_q = dispatches_q.filter(ReminderDispatch.kind == kind_f)
    if channel_f in ("email", "in_app"):
        dispatches_q = dispatches_q.filter(ReminderDispatch.channel == channel_f)
    if status_f and status_f != "partial":
        dispatches_q = dispatches_q.filter(ReminderDispatch.status == status_f)

    jobs_total = jobs_q.count()
    jobs = (
        jobs_q.order_by(ReminderJob.created_at.desc(), ReminderJob.id.desc()).limit(lim).all()
    )
    # Pull a wider dispatch window so per-equipment rows can collapse into sends
    dispatches = (
        dispatches_q.order_by(ReminderDispatch.created_at.desc(), ReminderDispatch.id.desc())
        .limit(5000)
        .all()
    )

    user_ids: set[int] = set()
    recipient_ids: set[int] = set()
    for d in dispatches:
        key = (d.recipient_key or "").strip()
        if key.startswith("user:"):
            try:
                user_ids.add(int(key.split(":", 1)[1]))
            except ValueError:
                pass
        elif key.startswith("recipient:"):
            try:
                recipient_ids.add(int(key.split(":", 1)[1]))
            except ValueError:
                pass

    users_by_id = {
        u.id: u
        for u in (db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else [])
    }
    recipients_by_id = {
        r.id: r
        for r in (
            db.query(NotificationRecipient)
            .filter(
                NotificationRecipient.tenant_id == ctx.tenant_id,
                NotificationRecipient.id.in_(recipient_ids),
            )
            .all()
            if recipient_ids
            else []
        )
    }

    def resolve_recipient(key: str) -> tuple[str, str]:
        raw = (key or "").strip()
        if raw == "in_app":
            return "All in-app users", ""
        if raw.startswith("user:"):
            try:
                uid = int(raw.split(":", 1)[1])
            except ValueError:
                return raw, ""
            user = users_by_id.get(uid)
            if user is None:
                return f"User #{uid}", ""
            name = (user.full_name or "").strip() or user.email
            return name, user.email or ""
        if raw.startswith("recipient:"):
            try:
                rid = int(raw.split(":", 1)[1])
            except ValueError:
                return raw, ""
            row = recipients_by_id.get(rid)
            if row is None:
                return f"Recipient #{rid}", ""
            name = (row.name or "").strip() or row.email
            return name, row.email or ""
        return raw, ""

    def batch_day(d: ReminderDispatch) -> str:
        when = d.sent_at or d.created_at
        if when is not None:
            return when.date().isoformat()
        pk = d.period_key or ""
        if ":" in pk:
            tail = pk.rsplit(":", 1)[-1]
            if len(tail) >= 10 and tail[4] == "-" and tail[7] == "-":
                return tail[:10]
        return "unknown"

    def reminder_subject(kind: str, channel: str, count: int) -> str:
        n = max(count, 1)
        plural = "s" if n != 1 else ""
        window = {
            "due_30": "30 days",
            "due_14": "14 days",
            "due_7": "7 days",
            "due_1": "1 day / due today",
        }
        if channel == "in_app":
            if kind == "overdue_daily":
                return f"In-app: {n} calibration{plural} overdue"
            if kind == "weekly_digest":
                return f"In-app: Weekly digest ({n} upcoming)"
            if kind in window:
                return f"In-app: {n} calibration{plural} due ({window[kind]})"
            return f"In-app: {kind} ({n})"
        if kind == "overdue_daily":
            return f"TrueGage — {n} calibration{plural} overdue"
        if kind == "weekly_digest":
            return f"TrueGage — Weekly digest: {n} upcoming"
        if kind in window:
            return f"TrueGage — {n} calibration{plural} due ({window[kind]})"
        return f"TrueGage — {kind} ({n})"

    # Aggregate: one row per recipient × kind × channel × day
    groups: dict[tuple[str, str, str, str], list[ReminderDispatch]] = {}
    for d in dispatches:
        key = (d.kind, d.channel, d.recipient_key or "", batch_day(d))
        groups.setdefault(key, []).append(d)

    send_outs: list[ReminderSendOut] = []
    for (kind_v, channel_v, recipient_key, day), rows in groups.items():
        if from_d or to_d:
            try:
                day_d = date.fromisoformat(day)
            except ValueError:
                day_d = None
            if day_d is not None:
                if from_d and day_d < from_d:
                    continue
                if to_d and day_d > to_d:
                    continue
            elif from_d or to_d:
                continue

        name, email = resolve_recipient(recipient_key)
        statuses = {r.status for r in rows}
        if "failed" in statuses and ("sent" in statuses or "pending" in statuses):
            status_v = "partial"
        elif statuses == {"sent"}:
            status_v = "sent"
        elif statuses == {"failed"}:
            status_v = "failed"
        elif "pending" in statuses:
            status_v = "pending"
        else:
            status_v = next(iter(statuses), "unknown")

        if status_f and status_v != status_f:
            continue

        errors = [r.error for r in rows if r.error]
        sent_times = [r.sent_at for r in rows if r.sent_at]
        count = len(rows)
        if kind_v == "weekly_digest":
            count = max(count, 1)
        subject = reminder_subject(kind_v, channel_v, count)

        if search:
            hay = " ".join(
                [
                    subject,
                    name,
                    email,
                    recipient_key,
                    kind_v,
                    channel_v,
                    status_v,
                ]
            ).lower()
            if search not in hay:
                continue

        send_outs.append(
            ReminderSendOut(
                kind=kind_v,
                channel=channel_v,
                status=status_v,
                subject=subject,
                recipient_key=recipient_key,
                recipient_name=name,
                recipient_email=email,
                equipment_count=count,
                sent_at=max(sent_times) if sent_times else None,
                error=errors[0] if errors else None,
            )
        )

    send_outs.sort(
        key=lambda s: (s.sent_at.isoformat() if s.sent_at else "", s.recipient_key),
        reverse=True,
    )
    sends_total = len(send_outs)
    send_outs = send_outs[:lim]

    return ReminderLogOut(
        jobs=[
            ReminderJobOut(
                id=j.id,
                job_kind=j.job_kind,
                job_date_local=j.job_date_local,
                status=j.status,
                attempts=int(j.attempts or 0),
                error=j.error,
                started_at=j.started_at,
                finished_at=j.finished_at,
                created_at=j.created_at,
            )
            for j in jobs
        ],
        sends=send_outs,
        jobs_total=jobs_total,
        sends_total=sends_total,
    )


@router.post("/internal/reminder-tick", response_model=ReminderTickOut)
def internal_reminder_tick(
    db: Session = Depends(get_db),
    x_reminder_secret: str | None = Header(default=None, alias="X-Reminder-Secret"),
    user: User | None = Depends(get_optional_user),
) -> ReminderTickOut:
    """Manual / ops tick. Accepts shared secret or platform_admin only (global job)."""
    settings = get_settings()
    secret = (settings.reminder_tick_secret or "").strip()
    provided = (x_reminder_secret or "").strip()
    secret_ok = bool(secret) and bool(provided) and hmac.compare_digest(provided, secret)
    platform_ok = bool(user) and user.role == PLATFORM_ADMIN
    if not secret_ok and not platform_ok:
        if provided and secret:
            raise HTTPException(status_code=403, detail="Invalid reminder tick secret")
        if user is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        raise HTTPException(status_code=403, detail="Platform admin access required")
    result = run_reminder_tick(db)
    processed = int(result.get("jobs_processed") or 0)
    return ReminderTickOut(
        ok=True,
        jobs_processed=processed,
        message=f"Processed {processed} reminder job(s)",
    )


@router.get("/notifications", response_model=AppNotificationListOut)
def list_notifications(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> AppNotificationListOut:
    return notifications_list_for_user(db, tenant_id=ctx.tenant_id, user_id=ctx.user.id)


@router.post("/notifications/mark-all-read", response_model=AppNotificationListOut)
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> AppNotificationListOut:
    rows = sync_due_date_notifications(db, ctx.tenant_id)
    _mark_notifications_read_for_user(
        db,
        user_id=ctx.user.id,
        notification_ids=[r.id for r in rows],
    )
    db.commit()
    return notifications_list_for_user(db, tenant_id=ctx.tenant_id, user_id=ctx.user.id)


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
    _mark_notifications_read_for_user(db, user_id=ctx.user.id, notification_ids=[row.id])
    db.commit()
    return notification_to_out(row, read=True)


@router.get("/email/history", response_model=EmailAuditListOut)
def list_email_history(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
    limit: int = 100,
) -> EmailAuditListOut:
    limit = max(1, min(limit, 500))
    query = db.query(EmailAuditLog).filter(EmailAuditLog.tenant_id == ctx.tenant_id)
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
