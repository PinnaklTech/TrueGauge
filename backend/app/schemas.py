from datetime import date, datetime
from enum import Enum
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
    status: CalStatus = "calibrated"
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


class PlatformSmtpOut(BaseModel):
    configured: bool
    source: str = "none"  # db | env | none
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_username: Optional[str] = None
    smtp_use_tls: bool = True
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    has_password: bool = False
    last_error: Optional[str] = None
    env_fallback_ready: bool = False


class PlatformSmtpIn(BaseModel):
    smtp_host: str = Field(..., min_length=1, max_length=255)
    smtp_port: int = Field(587, ge=1, le=65535)
    smtp_username: Optional[str] = Field(None, max_length=255)
    smtp_password: Optional[str] = Field(None, max_length=512)
    smtp_use_tls: bool = True
    smtp_from_email: str = Field(..., min_length=3, max_length=255)
    smtp_from_name: Optional[str] = Field("TrueGage", max_length=255)


class PlatformSmtpTestIn(BaseModel):
    to_email: str = Field(..., min_length=3, max_length=255)


class PlatformSmtpTestOut(BaseModel):
    ok: bool
    message: str


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


class CertificateOut(BaseModel):
    id: str
    equipment_id: str
    equipment_tag: str = ""
    equipment_name: str = ""
    calibration_id: Optional[str] = None
    file_name: str
    content_type: str
    size_bytes: int
    sha256: str = ""
    status: str
    uploaded_by: Optional[str] = None
    created_at: Optional[datetime] = None


class CertificateListOut(BaseModel):
    items: list[CertificateOut]
    total: int


class CertificateViewUrlOut(BaseModel):
    url: str
    expires_in: int
    file_name: str
    content_type: str = "application/pdf"


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
    updated_at: Optional[datetime] = None
    profile_setup_at: Optional[datetime] = None
    product_tour_at: Optional[datetime] = None


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
    send_credentials: bool = False


class AdminUserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    role: Optional[OrgUserRole] = None
    job_title: Optional[str] = Field(None, max_length=255)
    department: Optional[str] = Field(None, max_length=255)
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=12, max_length=128)


class SendCredentialsIn(BaseModel):
    password: str = Field(..., min_length=12, max_length=128)


class MeOut(UserOut):
    tenant_id: int
    tenant_name: str = ""
    tenant_slug: str = ""
    storage_enabled: bool = False
    storage_used_bytes: int = 0
    storage_quota_bytes: int = 0


class AuthTokenOut(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in: int = 3600
    user: UserOut
    tenant_id: int
    tenant_name: str = ""
    tenant_slug: str = ""


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


class StaffLoginIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    passcode: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class ForcePasswordIn(BaseModel):
    password: str = Field(..., min_length=12, max_length=128)


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
    mark_profile_setup: Optional[bool] = None


class TourCompleteIn(BaseModel):
    skipped: bool = False


class TenantOut(BaseModel):
    id: int
    slug: str
    name: str
    active: bool
    storage_enabled: bool = False
    created_at: Optional[datetime] = None
    user_count: int = 0
    equipment_count: int = 0
    overdue_count: int = 0
    smtp_configured: bool = False
    odoo_configured: bool = False


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
    admin_email: str = Field(..., min_length=3, max_length=255)
    admin_password: str = Field(..., min_length=12, max_length=128)
    admin_full_name: Optional[str] = Field(None, max_length=255)
    send_welcome_email: bool = True


class DayCountOut(BaseModel):
    date: str
    count: int = 0
    sent: int = 0
    failed: int = 0
    ok: int = 0
    fail: int = 0


class PlatformStaffCreateIn(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str = Field("", max_length=255)


class PlatformStaffUpdateIn(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=12, max_length=128)


class PlatformUserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    active: bool
    tenant_id: Optional[int] = None
    tenant_name: str = ""
    created_at: Optional[datetime] = None


class PlatformUserListOut(BaseModel):
    items: list[PlatformUserOut]
    total: int


class PlatformDataSummaryOut(BaseModel):
    tenants: int
    users: int
    staff: int
    equipment: int
    calibrations: int
    email_audits: int
    auth_events: int
    notifications: int
    system_smtp_ready: bool = False


class PlatformDataTableOut(BaseModel):
    table: str
    columns: list[str]
    rows: list[dict]
    total: int
    limit: int
    offset: int


class TenantUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    slug: Optional[str] = Field(None, max_length=64)
    active: Optional[bool] = None
    storage_enabled: Optional[bool] = None


class TenantSwitchIn(BaseModel):
    tenant_id: int


class PlatformOverviewOut(BaseModel):
    tenant_count: int
    active_tenant_count: int = 0
    inactive_tenant_count: int = 0
    user_count: int
    staff_count: int = 0
    email_7d_sent: int = 0
    email_7d_failed: int = 0
    smtp_configured_tenants: int = 0
    odoo_configured_tenants: int = 0
    auth_events_24h: int = 0
    auth_failures_24h: int = 0
    onboardings_30d: int = 0
    # Kept for older clients; always 0 in new overview
    equipment_count: int = 0
    overdue_count: int = 0
    recent_tenants: list[TenantOut]
    system_status: str = "ok"
    database_status: str = "up"
    system_smtp_ready: bool = False
    onboardings_by_day: list[DayCountOut] = []
    emails_by_day: list[DayCountOut] = []
    auth_by_day: list[DayCountOut] = []
    # Attention strip
    attention_suspended: int = 0
    attention_failed_welcomes_7d: int = 0
    attention_active_without_smtp: int = 0


class ChecklistItemOut(BaseModel):
    id: str
    label: str
    done: bool


class PlatformTenantSummaryOut(BaseModel):
    tenant_id: int
    name: str
    slug: str
    active: bool
    storage_enabled: bool = False
    storage_used_bytes: int = 0
    storage_quota_bytes: int = 0
    certificate_count: int = 0
    user_count: int = 0
    active_user_count: int = 0
    admin_count: int = 0
    equipment_count: int = 0
    overdue_count: int = 0
    calibration_count: int = 0
    email_7d_sent: int = 0
    email_7d_failed: int = 0
    smtp_configured: bool = False
    odoo_configured: bool = False
    system_smtp_ready: bool = False
    timezone: str = "UTC"
    company_name: str = ""
    industry: str = ""
    address: str = ""
    accent_color: str = "#0f766e"
    odoo_url: Optional[str] = None
    odoo_connected: bool = False
    odoo_last_error: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_from_email: Optional[str] = None
    last_auth_at: Optional[datetime] = None
    last_email_at: Optional[datetime] = None
    checklist: list[ChecklistItemOut] = []


class WelcomeEmailIn(BaseModel):
    user_id: Optional[int] = None
    password: str = Field(..., min_length=12, max_length=128)


class PlatformEmailQueueItem(BaseModel):
    id: int
    kind: str
    subject: str
    to_email: str
    to_name: str
    status: str
    error: Optional[str] = None
    equipment_count: int = 0
    detail: Optional[str] = None
    org_member: bool = True
    created_at: datetime
    tenant_id: int
    tenant_name: str = ""


class PlatformEmailQueueOut(BaseModel):
    items: list[PlatformEmailQueueItem]
    total: int


class PlatformTenantEquipmentOut(BaseModel):
    id: str
    tag: str
    name: str
    status: str
    department: str = ""
    location: str = ""
    next_calibration: Optional[str] = None
    last_calibration: Optional[str] = None
    owner: str = ""


class PlatformTenantEquipmentListOut(BaseModel):
    items: list[PlatformTenantEquipmentOut]
    total: int


class PlatformActivityItem(BaseModel):
    id: str
    kind: str
    title: str
    detail: str = ""
    status: str = ""
    tenant_id: Optional[int] = None
    tenant_name: str = ""
    created_at: Optional[datetime] = None


class PlatformActivityOut(BaseModel):
    items: list[PlatformActivityItem]
    total: int


class PlatformHealthOut(BaseModel):
    status: str
    database: str
    environment: str


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


class OrgTaxonomyOut(BaseModel):
    departments: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)


class OrgTaxonomyIn(BaseModel):
    departments: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)


class OrgTaxonomyTermKind(str, Enum):
    departments = "departments"
    categories = "categories"
    locations = "locations"


class OrgTaxonomyTermIn(BaseModel):
    kind: OrgTaxonomyTermKind
    value: str = Field(..., min_length=1, max_length=255)


class OrgTaxonomyTermRenameIn(BaseModel):
    kind: OrgTaxonomyTermKind
    from_value: str = Field(..., min_length=1, max_length=255, alias="from")
    to_value: str = Field(..., min_length=1, max_length=255, alias="to")

    model_config = {"populate_by_name": True}


class ReminderRulesOut(BaseModel):
    remind_30d: bool = False
    remind_14d: bool = False
    remind_7d: bool = False
    remind_1d: bool = False
    remind_overdue_daily: bool = False
    remind_weekly_digest: bool = False
    reminder_hour_local: int = 8
    last_daily_run_at: Optional[datetime] = None


class ReminderRulesIn(BaseModel):
    remind_30d: bool = False
    remind_14d: bool = False
    remind_7d: bool = False
    remind_1d: bool = False
    remind_overdue_daily: bool = False
    remind_weekly_digest: bool = False
    reminder_hour_local: int = Field(8, ge=0, le=23)


class ReminderTickOut(BaseModel):
    ok: bool = True
    jobs_processed: int = 0
    message: str = ""


class ReminderJobOut(BaseModel):
    id: int
    job_kind: str
    job_date_local: date
    status: str
    attempts: int
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class ReminderDispatchOut(BaseModel):
    id: int
    kind: str
    channel: str
    status: str
    period_key: str
    recipient_key: str
    recipient_name: str = ""
    recipient_email: str = ""
    equipment_public_id: Optional[str] = None
    error: Optional[str] = None
    sent_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class ReminderSendOut(BaseModel):
    """One aggregated delivery (per recipient × kind × channel × day)."""

    kind: str
    channel: str
    status: str
    subject: str
    recipient_key: str
    recipient_name: str = ""
    recipient_email: str = ""
    equipment_count: int = 0
    sent_at: Optional[datetime] = None
    error: Optional[str] = None


class ReminderLogOut(BaseModel):
    jobs: list[ReminderJobOut]
    sends: list[ReminderSendOut]
    jobs_total: int
    sends_total: int


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


class AuditEventOut(BaseModel):
    id: str
    user_name: str
    action: str
    target_type: str
    target_id: Optional[str] = None
    target_name: str
    detail: str = ""
    timestamp: datetime


class AuditEventListOut(BaseModel):
    items: list[AuditEventOut]
    total: int

