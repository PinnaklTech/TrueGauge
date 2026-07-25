from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.accounts import get_or_create_settings, log_email_send, notify_email_batch
from app.config import get_settings
from app.database import get_db
from app.deps import TenantContext, get_tenant_context, is_org_admin_role, require_admin
from app.models import (
    CalibrationRecord,
    EquipmentCache,
    NotificationRecipient,
    new_calibration_id,
    new_public_id,
)
from app.schemas import (
    CalibrationCreate,
    CalibrationListOut,
    CalibrationOut,
    EquipmentCreate,
    EquipmentListOut,
    EquipmentOut,
    EquipmentUpdate,
    EmailSettingsIn,
    EmailSettingsOut,
    EmailTestRecipientResult,
    EmailTestSendIn,
    EmailTestSendOut,
    OverdueAlertSendIn,
    OverdueAlertSendOut,
    HealthOut,
    OdooConnectionStatus,
    OdooCredentialsIn,
    OdooTestResult,
    SyncResult,
    TeamMemberCreate,
    TeamMemberListOut,
    TeamMemberOut,
    TeamMemberUpdate,
)
from app.security import decrypt_secret, encrypt_secret
from app.services.email_service import (
    EmailError,
    OverdueEquipmentRow,
    load_smtp_config,
    send_overdue_alert_email,
    send_test_email,
    smtp_configured,
)
from app.services.equipment_sync import (
    compute_status,
    refresh_equipment_status,
    refresh_equipment_statuses,
    sync_equipment_from_odoo,
)
from app.services.odoo_client import OdooClient, OdooError

router = APIRouter()


def _parse_optional_date(value: Optional[str]) -> Optional[date]:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc


def equipment_to_out(row: EquipmentCache) -> EquipmentOut:
    return EquipmentOut(
        id=row.public_id,
        odoo_id=row.odoo_id,
        source=row.source,  # type: ignore[arg-type]
        tag=row.tag,
        name=row.name,
        category=row.category,
        manufacturer=row.manufacturer,
        model=row.model,
        serial=row.serial,
        department=row.department,
        location=row.location,
        status=row.status,  # type: ignore[arg-type]
        last_calibration=row.last_calibration.isoformat() if row.last_calibration else None,
        next_calibration=row.next_calibration.isoformat() if row.next_calibration else None,
        frequency_days=row.frequency_days,
        owner=row.owner,
        responsible_email=row.responsible_email,
    )


def find_equipment(db: Session, equipment_id: str, tenant_id: int) -> EquipmentCache:
    row = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.public_id == equipment_id, EquipmentCache.tenant_id == tenant_id)
        .one_or_none()
    )
    if row is None and equipment_id.startswith("eq-"):
        # Legacy lookup by odoo_id for older bookmarks (eq-{odoo_id})
        try:
            odoo_id = int(equipment_id.removeprefix("eq-"))
            row = (
                db.query(EquipmentCache)
                .filter(EquipmentCache.odoo_id == odoo_id, EquipmentCache.tenant_id == tenant_id)
                .one_or_none()
            )
        except ValueError:
            row = None
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if refresh_equipment_status(row):
        db.commit()
        db.refresh(row)
    return row


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)) -> HealthOut:
    try:
        db.execute(text("SELECT 1"))
        return HealthOut(status="ok", database="up")
    except Exception:
        return HealthOut(status="degraded", database="down")


@router.get("/odoo/status", response_model=OdooConnectionStatus)
def odoo_status(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> OdooConnectionStatus:
    row = get_or_create_settings(db, ctx.tenant_id)
    count = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == ctx.tenant_id).count()
    configured = bool(row.odoo_url and row.odoo_database and row.odoo_username and row.odoo_api_key_encrypted)
    return OdooConnectionStatus(
        configured=configured,
        connected=bool(row.odoo_connected),
        odoo_url=row.odoo_url,
        odoo_database=row.odoo_database,
        odoo_username=row.odoo_username,
        last_sync_at=row.odoo_last_sync_at,
        last_error=row.odoo_last_error,
        equipment_count=count,
        field_calibration_date=row.field_calibration_date,
        field_calibration_due=row.field_calibration_due,
        field_responsible_email=row.field_responsible_email,
    )


@router.put("/odoo/credentials", response_model=OdooConnectionStatus)
def save_odoo_credentials(
    body: OdooCredentialsIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> OdooConnectionStatus:
    row = get_or_create_settings(db, ctx.tenant_id)
    row.odoo_url = body.odoo_url.rstrip("/")
    row.odoo_database = body.odoo_database
    row.odoo_username = body.odoo_username
    row.odoo_api_key_encrypted = encrypt_secret(body.odoo_api_key)
    row.field_calibration_date = body.field_calibration_date
    row.field_calibration_due = body.field_calibration_due
    row.field_responsible_email = body.field_responsible_email
    row.odoo_connected = False
    row.odoo_last_error = None
    db.commit()
    return odoo_status(db, ctx)


@router.post("/odoo/test", response_model=OdooTestResult)
def test_odoo_connection(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> OdooTestResult:
    row = get_or_create_settings(db, ctx.tenant_id)
    if not (row.odoo_url and row.odoo_database and row.odoo_username and row.odoo_api_key_encrypted):
        raise HTTPException(status_code=400, detail="Odoo credentials are not configured")
    try:
        client = OdooClient(
            url=row.odoo_url,
            database=row.odoo_database,
            username=row.odoo_username,
            api_key=decrypt_secret(row.odoo_api_key_encrypted),
        )
        version = client.version()
        uid = client.authenticate()
        row.odoo_connected = True
        row.odoo_last_error = None
        db.commit()
        ver = version.get("server_version") or version.get("server_serie") or "unknown"
        return OdooTestResult(ok=True, uid=uid, version=str(ver), message="Connected to Odoo successfully")
    except OdooError as exc:
        row.odoo_connected = False
        row.odoo_last_error = str(exc)
        db.commit()
        return OdooTestResult(ok=False, message=str(exc))
    except Exception as exc:
        row.odoo_connected = False
        row.odoo_last_error = str(exc)
        db.commit()
        return OdooTestResult(ok=False, message=f"Connection failed: {exc}")


@router.post("/odoo/sync", response_model=SyncResult)
def sync_odoo_equipment(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> SyncResult:
    row = get_or_create_settings(db, ctx.tenant_id)
    try:
        result = sync_equipment_from_odoo(db, row)
        return SyncResult(
            ok=True,
            imported=result["imported"],
            updated=result.get("updated", 0),
            skipped=result["skipped"],
            total_in_odoo=result["total_in_odoo"],
            synced=result["imported"] + result.get("updated", 0),
            message=result["message"],
            synced_at=datetime.now(timezone.utc),
            fields_used=result.get("fields_used") or [],
        )
    except OdooError as exc:
        row.odoo_connected = False
        row.odoo_last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        row.odoo_last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}") from exc


@router.get("/equipment", response_model=EquipmentListOut)
def list_equipment(
    q: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> EquipmentListOut:
    # Dashboard filters by status; recompute from due dates so "due soon" stays accurate.
    eq_rows = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == ctx.tenant_id).all()
    refresh_equipment_statuses(db, eq_rows)

    query = db.query(EquipmentCache).filter(EquipmentCache.tenant_id == ctx.tenant_id)
    if status and status != "all":
        query = query.filter(EquipmentCache.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (EquipmentCache.name.ilike(like))
            | (EquipmentCache.tag.ilike(like))
            | (EquipmentCache.serial.ilike(like))
        )
    rows = query.order_by(EquipmentCache.name.asc()).all()
    return EquipmentListOut(items=[equipment_to_out(r) for r in rows], total=len(rows))


@router.post("/equipment", response_model=EquipmentOut, status_code=201)
def create_equipment(
    body: EquipmentCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> EquipmentOut:
    last_cal = _parse_optional_date(body.last_calibration)
    next_cal = _parse_optional_date(body.next_calibration)
    # Respect explicit status from the form; only derive when left at default inactive with a due date
    status = body.status
    if body.status == "inactive" and next_cal is not None:
        status = compute_status(next_cal)  # type: ignore[assignment]

    tag = body.tag.strip() or body.serial.strip() or body.name.strip()[:32]
    row = EquipmentCache(
        tenant_id=ctx.tenant_id,
        public_id=new_public_id(),
        odoo_id=None,
        source="local",
        tag=tag,
        name=body.name.strip(),
        category=body.category.strip(),
        manufacturer=body.manufacturer.strip(),
        model=body.model.strip(),
        serial=body.serial.strip(),
        department=body.department.strip(),
        location=body.location.strip(),
        status=status,
        last_calibration=last_cal,
        next_calibration=next_cal,
        frequency_days=body.frequency_days,
        owner=body.owner.strip(),
        responsible_email=body.responsible_email,
        raw_payload=None,
        synced_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return equipment_to_out(row)


@router.get("/equipment/{equipment_id}", response_model=EquipmentOut)
def get_equipment(
    equipment_id: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> EquipmentOut:
    return equipment_to_out(find_equipment(db, equipment_id, ctx.tenant_id))


@router.patch("/equipment/{equipment_id}", response_model=EquipmentOut)
def update_equipment(
    equipment_id: str,
    body: EquipmentUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> EquipmentOut:
    row = find_equipment(db, equipment_id, ctx.tenant_id)
    data = body.model_dump(exclude_unset=True)
    status_explicit = "status" in data

    if "last_calibration" in data:
        row.last_calibration = _parse_optional_date(data.pop("last_calibration"))
    if "next_calibration" in data:
        row.next_calibration = _parse_optional_date(data.pop("next_calibration"))

    for key, value in data.items():
        if isinstance(value, str) and key not in ("status", "responsible_email"):
            value = value.strip()
        setattr(row, key, value)

    # Only derive status from due date when the client did not send an explicit status
    if not status_explicit:
        row.status = compute_status(row.next_calibration)

    row.synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return equipment_to_out(row)


@router.delete("/equipment/{equipment_id}", status_code=204)
def delete_equipment(
    equipment_id: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> Response:
    row = find_equipment(db, equipment_id, ctx.tenant_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def calibration_to_out(row: CalibrationRecord) -> CalibrationOut:
    eq = row.equipment
    return CalibrationOut(
        id=row.public_id,
        equipment_id=eq.public_id if eq else "",
        equipment_tag=eq.tag if eq else "",
        equipment_name=eq.name if eq else "",
        date=row.performed_on.isoformat(),
        due_date=row.due_date.isoformat() if row.due_date else None,
        result=row.result,  # type: ignore[arg-type]
        provider=row.provider_name,
        type=row.provider_type,  # type: ignore[arg-type]
        technician=row.technician,
        certificate_no=row.certificate_no,
        notes=row.notes,
        created_at=row.created_at,
    )


def find_calibration(db: Session, calibration_id: str, tenant_id: int) -> CalibrationRecord:
    row = (
        db.query(CalibrationRecord)
        .filter(CalibrationRecord.public_id == calibration_id, CalibrationRecord.tenant_id == tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Calibration record not found")
    return row


@router.get("/calibrations", response_model=CalibrationListOut)
def list_calibrations(
    equipment_id: str | None = None,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> CalibrationListOut:
    query = (
        db.query(CalibrationRecord)
        .join(EquipmentCache)
        .filter(CalibrationRecord.tenant_id == ctx.tenant_id)
    )
    if equipment_id:
        eq = find_equipment(db, equipment_id, ctx.tenant_id)
        query = query.filter(CalibrationRecord.equipment_id == eq.id)
    rows = query.order_by(CalibrationRecord.performed_on.desc(), CalibrationRecord.id.desc()).all()
    return CalibrationListOut(items=[calibration_to_out(r) for r in rows], total=len(rows))


@router.get("/equipment/{equipment_id}/calibrations", response_model=CalibrationListOut)
def list_equipment_calibrations(
    equipment_id: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> CalibrationListOut:
    eq = find_equipment(db, equipment_id, ctx.tenant_id)
    rows = (
        db.query(CalibrationRecord)
        .filter(CalibrationRecord.equipment_id == eq.id, CalibrationRecord.tenant_id == ctx.tenant_id)
        .order_by(CalibrationRecord.performed_on.desc(), CalibrationRecord.id.desc())
        .all()
    )
    return CalibrationListOut(items=[calibration_to_out(r) for r in rows], total=len(rows))


@router.post("/calibrations", response_model=CalibrationOut, status_code=201)
def create_calibration(
    body: CalibrationCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> CalibrationOut:
    eq = find_equipment(db, body.equipment_id, ctx.tenant_id)
    performed = _parse_optional_date(body.date)
    if performed is None:
        raise HTTPException(status_code=400, detail="Verification date is required")

    next_due = _parse_optional_date(body.next_calibration)
    if next_due is None and body.update_equipment_dates:
        freq = eq.frequency_days if eq.frequency_days and eq.frequency_days > 0 else 365
        next_due = performed + timedelta(days=freq)

    record = CalibrationRecord(
        tenant_id=ctx.tenant_id,
        public_id=new_calibration_id(),
        equipment_id=eq.id,
        performed_on=performed,
        due_date=next_due,
        result=body.result,
        provider_type=body.type,
        provider_name=body.provider.strip(),
        technician=body.technician.strip(),
        certificate_no=body.certificate_no.strip(),
        notes=(body.notes.strip() if body.notes else None) or None,
    )
    db.add(record)

    if body.update_equipment_dates:
        eq.last_calibration = performed
        if next_due is not None:
            eq.next_calibration = next_due
        if body.result == "fail":
            eq.status = "failed"
        else:
            eq.status = compute_status(eq.next_calibration)
        eq.synced_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(record)
    return calibration_to_out(record)


@router.get("/calibrations/{calibration_id}", response_model=CalibrationOut)
def get_calibration(
    calibration_id: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> CalibrationOut:
    return calibration_to_out(find_calibration(db, calibration_id, ctx.tenant_id))


@router.delete("/calibrations/{calibration_id}", status_code=204)
def delete_calibration(
    calibration_id: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> Response:
    row = find_calibration(db, calibration_id, ctx.tenant_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _team_member_out(row: NotificationRecipient) -> TeamMemberOut:
    return TeamMemberOut(
        id=row.id,
        email=row.email,
        name=row.name,
        role=row.role,
        active=row.active,
        org_member=bool(row.org_member),
    )


@router.get("/team", response_model=TeamMemberListOut)
def list_team_members(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> TeamMemberListOut:
    rows = (
        db.query(NotificationRecipient)
        .filter(NotificationRecipient.tenant_id == ctx.tenant_id)
        .order_by(NotificationRecipient.name.asc(), NotificationRecipient.email.asc())
        .all()
    )
    return TeamMemberListOut(items=[_team_member_out(r) for r in rows], total=len(rows))


@router.post("/team", response_model=TeamMemberOut, status_code=201)
def create_team_member(
    payload: TeamMemberCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> TeamMemberOut:
    email = _normalize_email(payload.email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    existing = (
        db.query(NotificationRecipient)
        .filter(NotificationRecipient.tenant_id == ctx.tenant_id, NotificationRecipient.email == email)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="This email is already on the team")
    row = NotificationRecipient(
        tenant_id=ctx.tenant_id,
        email=email,
        name=payload.name.strip(),
        role=(payload.role or "member").strip() or "member",
        active=payload.active,
        org_member=payload.org_member,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _team_member_out(row)


@router.patch("/team/{member_id}", response_model=TeamMemberOut)
def update_team_member(
    member_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> TeamMemberOut:
    row = (
        db.query(NotificationRecipient)
        .filter(NotificationRecipient.id == member_id, NotificationRecipient.tenant_id == ctx.tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    data = payload.model_dump(exclude_unset=True)
    if "email" in data and data["email"] is not None:
        email = _normalize_email(data["email"])
        if "@" not in email or "." not in email.split("@")[-1]:
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        clash = (
            db.query(NotificationRecipient)
            .filter(
                NotificationRecipient.tenant_id == ctx.tenant_id,
                NotificationRecipient.email == email,
                NotificationRecipient.id != member_id,
            )
            .one_or_none()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="This email is already on the team")
        data["email"] = email
    if "name" in data and isinstance(data["name"], str):
        data["name"] = data["name"].strip()
    if "role" in data and isinstance(data["role"], str):
        data["role"] = data["role"].strip() or "member"
    for key, value in data.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _team_member_out(row)


@router.delete("/team/{member_id}", status_code=204)
def delete_team_member(
    member_id: int,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> Response:
    row = (
        db.query(NotificationRecipient)
        .filter(NotificationRecipient.id == member_id, NotificationRecipient.tenant_id == ctx.tenant_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def _email_settings_out(row) -> EmailSettingsOut:
    return EmailSettingsOut(
        configured=smtp_configured(row),
        smtp_host=row.smtp_host,
        smtp_port=row.smtp_port or 587,
        smtp_username=row.smtp_username,
        smtp_use_tls=bool(row.smtp_use_tls),
        smtp_from_email=row.smtp_from_email,
        smtp_from_name=row.smtp_from_name or "TrueGage",
        has_password=bool(row.smtp_password_encrypted),
        last_error=row.smtp_last_error,
    )


@router.get("/email/settings", response_model=EmailSettingsOut)
def get_email_settings(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> EmailSettingsOut:
    return _email_settings_out(get_or_create_settings(db, ctx.tenant_id))


@router.put("/email/settings", response_model=EmailSettingsOut)
def save_email_settings(
    body: EmailSettingsIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> EmailSettingsOut:
    row = get_or_create_settings(db, ctx.tenant_id)
    from_email = body.smtp_from_email.strip().lower()
    if "@" not in from_email or "." not in from_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid From email address")

    row.smtp_host = body.smtp_host.strip()
    row.smtp_port = body.smtp_port
    row.smtp_username = (body.smtp_username or "").strip() or None
    row.smtp_use_tls = body.smtp_use_tls
    row.smtp_from_email = from_email
    row.smtp_from_name = (body.smtp_from_name or "TrueGage").strip() or "TrueGage"
    if body.smtp_password and body.smtp_password.strip():
        row.smtp_password_encrypted = encrypt_secret(body.smtp_password.strip())
    elif not row.smtp_password_encrypted:
        raise HTTPException(status_code=400, detail="SMTP password is required the first time you save")
    row.smtp_last_error = None
    db.commit()
    db.refresh(row)
    return _email_settings_out(row)


@router.post("/email/test-send", response_model=EmailTestSendOut)
def send_email_check(
    body: EmailTestSendIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_admin),
) -> EmailTestSendOut:
    row = get_or_create_settings(db, ctx.tenant_id)
    if not smtp_configured(row):
        raise HTTPException(
            status_code=400,
            detail="Configure Email Delivery (SMTP host, From email, and password) before sending.",
        )

    members = (
        db.query(NotificationRecipient)
        .filter(
            NotificationRecipient.tenant_id == ctx.tenant_id,
            NotificationRecipient.id.in_(body.member_ids),
        )
        .all()
    )
    if not members:
        raise HTTPException(status_code=400, detail="Select at least one team member")

    try:
        config = load_smtp_config(row)
    except EmailError as exc:
        row.smtp_last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    results: list[EmailTestRecipientResult] = []
    sent = 0
    failed = 0
    for member in members:
        try:
            send_test_email(config, to_email=member.email, to_name=member.name or "")
            results.append(
                EmailTestRecipientResult(
                    member_id=member.id,
                    email=member.email,
                    name=member.name,
                    ok=True,
                )
            )
            log_email_send(
                db,
                tenant_id=ctx.tenant_id,
                kind="test_check",
                subject="TrueGage — SMTP check",
                to_email=member.email,
                to_name=member.name or "",
                status="sent",
                org_member=bool(member.org_member),
            )
            sent += 1
        except EmailError as exc:
            results.append(
                EmailTestRecipientResult(
                    member_id=member.id,
                    email=member.email,
                    name=member.name,
                    ok=False,
                    error=str(exc),
                )
            )
            log_email_send(
                db,
                tenant_id=ctx.tenant_id,
                kind="test_check",
                subject="TrueGage — SMTP check",
                to_email=member.email,
                to_name=member.name or "",
                status="failed",
                error=str(exc),
                org_member=bool(member.org_member),
            )
            failed += 1

    if failed and sent == 0:
        row.smtp_last_error = results[0].error
    elif failed == 0:
        row.smtp_last_error = None
    else:
        row.smtp_last_error = f"{failed} of {sent + failed} check emails failed"
    db.commit()

    if sent or failed:
        notify_email_batch(db, tenant_id=ctx.tenant_id, kind="test_check", sent=sent, failed=failed)

    ok = failed == 0
    message = (
        f"Sent check email to {sent} recipient{'s' if sent != 1 else ''}"
        if ok
        else f"Sent {sent}, failed {failed}. Check SMTP settings and try again."
    )
    return EmailTestSendOut(ok=ok, sent=sent, failed=failed, message=message, results=results)


def _overdue_equipment_rows(db: Session, tenant_id: int) -> list[OverdueEquipmentRow]:
    today = date.today()
    rows = (
        db.query(EquipmentCache)
        .filter(EquipmentCache.tenant_id == tenant_id, EquipmentCache.status != "inactive")
        .all()
    )
    overdue: list[OverdueEquipmentRow] = []
    for row in rows:
        next_cal = row.next_calibration
        if next_cal is None:
            continue
        if next_cal > today:
            continue
        days_overdue = (today - next_cal).days
        overdue.append(
            OverdueEquipmentRow(
                name=row.name or "Unnamed equipment",
                tag=row.tag or row.public_id,
                due_date=next_cal.isoformat(),
                days_overdue=days_overdue,
            )
        )
    overdue.sort(key=lambda r: (-r.days_overdue, r.name.lower()))
    return overdue


@router.post("/email/overdue-alert", response_model=OverdueAlertSendOut)
def send_overdue_alert(
    body: OverdueAlertSendIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
) -> OverdueAlertSendOut:
    settings_row = get_or_create_settings(db, ctx.tenant_id)
    if not smtp_configured(settings_row):
        raise HTTPException(
            status_code=400,
            detail="Configure Email Delivery (SMTP host, From email, and password) before sending.",
        )

    items = _overdue_equipment_rows(db, ctx.tenant_id)
    if not items:
        raise HTTPException(status_code=400, detail="No overdue equipment to report right now")

    members = (
        db.query(NotificationRecipient)
        .filter(
            NotificationRecipient.tenant_id == ctx.tenant_id,
            NotificationRecipient.id.in_(body.member_ids),
        )
        .all()
    )
    if not members:
        raise HTTPException(status_code=400, detail="Select at least one team member")

    # Non-admins may only email organization members (not TrueGage staff contacts)
    if not is_org_admin_role(ctx.user.role):
        blocked = [m for m in members if not m.org_member]
        if blocked:
            raise HTTPException(
                status_code=403,
                detail="You can only send to organization members. Ask an admin to email TrueGage team contacts.",
            )
        members = [m for m in members if m.org_member]
        if not members:
            raise HTTPException(status_code=400, detail="Select at least one organization member")

    try:
        config = load_smtp_config(settings_row)
    except EmailError as exc:
        settings_row.smtp_last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    results: list[EmailTestRecipientResult] = []
    sent = 0
    failed = 0
    subject = f"TrueGage — {len(items)} calibration{'s' if len(items) != 1 else ''} overdue"
    for member in members:
        try:
            send_overdue_alert_email(
                config,
                to_email=member.email,
                to_name=member.name or "",
                items=items,
                cta_url=get_settings().overdue_equipment_url,
            )
            results.append(
                EmailTestRecipientResult(
                    member_id=member.id,
                    email=member.email,
                    name=member.name,
                    ok=True,
                )
            )
            log_email_send(
                db,
                tenant_id=ctx.tenant_id,
                kind="overdue_alert",
                subject=subject,
                to_email=member.email,
                to_name=member.name or "",
                status="sent",
                equipment_count=len(items),
                detail=f"{len(items)} overdue equipment item(s)",
                org_member=bool(member.org_member),
            )
            sent += 1
        except EmailError as exc:
            results.append(
                EmailTestRecipientResult(
                    member_id=member.id,
                    email=member.email,
                    name=member.name,
                    ok=False,
                    error=str(exc),
                )
            )
            log_email_send(
                db,
                tenant_id=ctx.tenant_id,
                kind="overdue_alert",
                subject=subject,
                to_email=member.email,
                to_name=member.name or "",
                status="failed",
                error=str(exc),
                equipment_count=len(items),
                org_member=bool(member.org_member),
            )
            failed += 1

    if failed and sent == 0:
        settings_row.smtp_last_error = results[0].error
    elif failed == 0:
        settings_row.smtp_last_error = None
    else:
        settings_row.smtp_last_error = f"{failed} of {sent + failed} overdue alert emails failed"
    db.commit()

    if sent or failed:
        notify_email_batch(
            db,
            tenant_id=ctx.tenant_id,
            kind="overdue_alert",
            sent=sent,
            failed=failed,
            equipment_count=len(items),
        )

    ok = failed == 0
    message = (
        f"Sent overdue list ({len(items)} items) to {sent} recipient{'s' if sent != 1 else ''}"
        if ok
        else f"Sent {sent}, failed {failed}. Check SMTP settings and try again."
    )
    return OverdueAlertSendOut(
        ok=ok,
        sent=sent,
        failed=failed,
        equipment_count=len(items),
        message=message,
        results=results,
    )
