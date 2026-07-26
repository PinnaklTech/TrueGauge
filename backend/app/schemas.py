from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class OdooCredentialsIn(BaseModel):
    odoo_url: str = Field(..., min_length=8, description="e.g. https://mycompany.odoo.com")
    odoo_database: str = Field(..., min_length=1)
    odoo_username: str = Field(..., min_length=1)
    odoo_api_key: str = Field(..., min_length=1)
    field_calibration_date: Optional[str] = None
    field_calibration_due: Optional[str] = None
    field_responsible_email: Optional[str] = None


class OdooConnectionStatus(BaseModel):
    configured: bool
    connected: bool
    odoo_url: Optional[str] = None
    odoo_database: Optional[str] = None
    odoo_username: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None
    equipment_count: int = 0
    field_calibration_date: Optional[str] = None
    field_calibration_due: Optional[str] = None
    field_responsible_email: Optional[str] = None


class OdooTestResult(BaseModel):
    ok: bool
    uid: Optional[int] = None
    version: Optional[str] = None
    message: str


class SyncResult(BaseModel):
    ok: bool
    imported: int
    updated: int = 0
    skipped: int
    total_in_odoo: int
    synced: int  # alias for imported (backward compatible for UI)
    message: str
    synced_at: datetime
    fields_used: list[str] = []


CalStatus = Literal["calibrated", "due-soon", "overdue", "failed", "inactive"]
EquipmentSource = Literal["local", "odoo"]


class EquipmentOut(BaseModel):
    id: str
    odoo_id: Optional[int] = None
    source: EquipmentSource = "local"
    tag: str
    name: str
    category: str
    manufacturer: str
    model: str
    serial: str
    department: str
    location: str
    status: CalStatus
    last_calibration: Optional[str] = None
    next_calibration: Optional[str] = None
    frequency_days: int
    owner: str
    responsible_email: Optional[str] = None

    model_config = {"from_attributes": True}


class EquipmentCreate(BaseModel):
    tag: str = ""
    name: str = Field(..., min_length=1)
    category: str = ""
    manufacturer: str = ""
    model: str = ""
    serial: str = ""
    department: str = ""
    location: str = ""
    status: CalStatus = "inactive"
    last_calibration: Optional[str] = None
    next_calibration: Optional[str] = None
    frequency_days: int = 365
    owner: str = ""
    responsible_email: Optional[str] = None


class EquipmentUpdate(BaseModel):
    tag: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    department: Optional[str] = None
    location: Optional[str] = None
    status: Optional[CalStatus] = None
    last_calibration: Optional[str] = None
    next_calibration: Optional[str] = None
    frequency_days: Optional[int] = None
    owner: Optional[str] = None
    responsible_email: Optional[str] = None


class EquipmentListOut(BaseModel):
    items: list[EquipmentOut]
    total: int


class HealthOut(BaseModel):
    status: str
    database: str


class TeamMemberOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    active: bool
    org_member: bool = True

    model_config = {"from_attributes": True}


class TeamMemberCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    name: str = Field("", max_length=255)
    role: str = Field("member", max_length=64)
    active: bool = True
    org_member: bool = True


class TeamMemberUpdate(BaseModel):
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    name: Optional[str] = Field(None, max_length=255)
    role: Optional[str] = Field(None, max_length=64)
    active: Optional[bool] = None
    org_member: Optional[bool] = None


class TeamMemberListOut(BaseModel):
    items: list[TeamMemberOut]
    total: int


class EmailSettingsOut(BaseModel):
    configured: bool
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_username: Optional[str] = None
    smtp_use_tls: bool = True
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    has_password: bool = False
    last_error: Optional[str] = None


class EmailSettingsIn(BaseModel):
    smtp_host: str = Field(..., min_length=1, max_length=255)
    smtp_port: int = Field(587, ge=1, le=65535)
    smtp_username: Optional[str] = Field(None, max_length=255)
    smtp_password: Optional[str] = Field(None, max_length=512)
    smtp_use_tls: bool = True
    smtp_from_email: str = Field(..., min_length=3, max_length=255)
    smtp_from_name: Optional[str] = Field("TrueGage", max_length=255)


class EmailTestSendIn(BaseModel):
    member_ids: list[int] = Field(..., min_length=1)


class EmailTestRecipientResult(BaseModel):
    member_id: int
    email: str
    name: str
    ok: bool
    error: Optional[str] = None


class EmailTestSendOut(BaseModel):
    ok: bool
    sent: int
    failed: int
    message: str
    results: list[EmailTestRecipientResult]


class OverdueAlertSendIn(BaseModel):
    member_ids: list[int] = Field(..., min_length=1)


class OverdueAlertSendOut(BaseModel):
    ok: bool
    sent: int
    failed: int
    equipment_count: int
    message: str
    results: list[EmailTestRecipientResult]


CalResult = Literal["pass", "fail", "conditional"]
ProviderType = Literal["internal", "external"]


class CalibrationOut(BaseModel):
    id: str
    equipment_id: str
    equipment_tag: str
    equipment_name: str
    date: str
    due_date: Optional[str] = None
    result: CalResult
    provider: str
    type: ProviderType
    technician: str
    certificate_no: str
    notes: Optional[str] = None
    created_at: Optional[datetime] = None


class CalibrationCreate(BaseModel):
    equipment_id: str = Field(..., min_length=1)
    date: str = Field(..., min_length=8, description="ISO date of verification")
    result: CalResult = "pass"
    type: ProviderType = "internal"
    provider: str = ""
    technician: str = ""
    certificate_no: str = ""
    notes: Optional[str] = None
    next_calibration: Optional[str] = Field(
        None,
        description="Optional next due date; defaults to verification date + equipment frequency",
    )
    update_equipment_dates: bool = Field(
        True,
        description="When true, refresh equipment last/next calibration and status from this record",
    )


class CalibrationListOut(BaseModel):
    items: list[CalibrationOut]
    total: int


# --- Auth / org / notifications / email audit ---

OrgUserRole = Literal["admin", "qa", "technician", "member"]
UserRole = Literal["platform_admin", "admin", "qa", "technician", "member"]


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    job_title: str
    department: str
    phone: str
    role: UserRole
    timezone: str
    locale: str
    notify_email: bool
    notify_in_app: bool
    active: bool = True
    tenant_id: Optional[int] = None


class UserListOut(BaseModel):
    items: list[UserOut]
    total: int


class AdminUserCreateIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str = Field("", max_length=255)
    role: OrgUserRole = "member"
    job_title: str = Field("", max_length=255)
    department: str = Field("", max_length=255)


class AdminUserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    role: Optional[OrgUserRole] = None
    job_title: Optional[str] = Field(None, max_length=255)
    department: Optional[str] = Field(None, max_length=255)
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=12, max_length=128)


class MeOut(UserOut):
    tenant_id: int
    tenant_name: str = ""


class AuthTokenOut(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in: int = 3600
    user: UserOut
    tenant_id: int
    tenant_name: str = ""


class RefreshIn(BaseModel):
    refresh_token: str = Field(..., min_length=20)


class HandoffCreateOut(BaseModel):
    code: str
    expires_in: int


class HandoffExchangeIn(BaseModel):
    code: str = Field(..., min_length=10, max_length=128)


class RegisterIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str = Field("", max_length=255)
    company_name: str = Field("", max_length=255)


class LoginIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    tenant_id: Optional[int] = None


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    job_title: Optional[str] = Field(None, max_length=255)
    department: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=64)
    role: Optional[OrgUserRole] = None
    timezone: Optional[str] = Field(None, max_length=64)
    locale: Optional[str] = Field(None, max_length=32)
    notify_email: Optional[bool] = None
    notify_in_app: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=12, max_length=128)
    current_password: Optional[str] = Field(None, min_length=1, max_length=128)


class TenantOut(BaseModel):
    id: int
    slug: str
    name: str
    active: bool
    created_at: Optional[datetime] = None
    user_count: int = 0
    equipment_count: int = 0
    overdue_count: int = 0


class TenantListOut(BaseModel):
    items: list[TenantOut]
    total: int


class TenantDetailOut(TenantOut):
    company_name: str = ""
    industry: str = ""
    address: str = ""
    timezone: str = "UTC"
    accent_color: str = "#0f766e"


class TenantCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: Optional[str] = Field(None, max_length=64)
    admin_email: Optional[str] = Field(None, max_length=255)
    admin_password: Optional[str] = Field(None, min_length=12, max_length=128)
    admin_full_name: Optional[str] = Field(None, max_length=255)


class TenantUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    active: Optional[bool] = None


class TenantSwitchIn(BaseModel):
    tenant_id: int


class PlatformOverviewOut(BaseModel):
    tenant_count: int
    user_count: int
    equipment_count: int
    overdue_count: int
    recent_tenants: list[TenantOut]



class OrgProfileOut(BaseModel):
    company_name: str
    industry: str
    address: str
    timezone: str
    accent_color: str


class OrgProfileIn(BaseModel):
    company_name: str = Field("", max_length=255)
    industry: str = Field("", max_length=255)
    address: str = Field("")
    timezone: str = Field("UTC", max_length=64)
    accent_color: str = Field("#0f766e", max_length=32)


class AppNotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    when: Optional[str] = None
    read: bool
    equipment_id: Optional[str] = None
    created_at: Optional[datetime] = None


class AppNotificationListOut(BaseModel):
    items: list[AppNotificationOut]
    total: int
    unread: int


class EmailAuditOut(BaseModel):
    id: int
    kind: str
    subject: str
    to_email: str
    to_name: str
    status: str
    error: Optional[str] = None
    equipment_count: int
    detail: Optional[str] = None
    org_member: bool = True
    created_at: datetime


class EmailAuditListOut(BaseModel):
    items: list[EmailAuditOut]
    total: int

