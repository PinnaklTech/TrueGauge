from datetime import date, datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def new_public_id() -> str:
    return f"eq-{uuid4().hex[:12]}"


def new_calibration_id() -> str:
    return f"cal-{uuid4().hex[:12]}"


def new_notification_id() -> str:
    return f"ntf-{uuid4().hex[:12]}"


class Tenant(Base):
    """Customer organization / workspace."""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TenantMembership(Base):
    """Platform staff access to a tenant (org users use users.tenant_id instead)."""

    __tablename__ = "tenant_memberships"
    __table_args__ = (UniqueConstraint("user_id", "tenant_id", name="uq_tenant_memberships_user_tenant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AppSettings(Base):
    """Per-tenant system/Odoo/SMTP/org settings."""

    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True
    )
    odoo_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    odoo_database: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    odoo_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    odoo_api_key_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    odoo_connected: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    odoo_last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    odoo_last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    field_calibration_date: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    field_calibration_due: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    field_responsible_email: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    smtp_host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int] = mapped_column(Integer, default=587, server_default="587")
    smtp_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_password_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    smtp_from_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_from_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Organization profile
    company_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    industry: Mapped[str] = mapped_column(String(255), default="", server_default="")
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    accent_color: Mapped[str] = mapped_column(String(32), default="#0f766e", server_default="#0f766e")

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base):
    """Workspace login account. Org users have tenant_id; platform_admin may be null."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    job_title: Mapped[str] = mapped_column(String(255), default="", server_default="")
    department: Mapped[str] = mapped_column(String(255), default="", server_default="")
    phone: Mapped[str] = mapped_column(String(64), default="", server_default="")
    role: Mapped[str] = mapped_column(String(64), default="admin", server_default="admin")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    locale: Mapped[str] = mapped_column(String(32), default="en-US", server_default="en-US")
    notify_email: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    notify_in_app: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EquipmentCache(Base):
    """App-owned equipment. Odoo import is optional and one-way."""

    __tablename__ = "equipment_cache"
    __table_args__ = (UniqueConstraint("tenant_id", "odoo_id", name="uq_equipment_tenant_odoo"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=new_public_id)
    odoo_id: Mapped[Optional[int]] = mapped_column(Integer, index=True, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="local", server_default="local", index=True)
    tag: Mapped[str] = mapped_column(String(128), default="", index=True)
    name: Mapped[str] = mapped_column(String(512), default="")
    category: Mapped[str] = mapped_column(String(255), default="")
    manufacturer: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    serial: Mapped[str] = mapped_column(String(255), default="")
    department: Mapped[str] = mapped_column(String(255), default="")
    location: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(32), default="inactive", index=True)
    last_calibration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    next_calibration: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    frequency_days: Mapped[int] = mapped_column(Integer, default=365)
    owner: Mapped[str] = mapped_column(String(255), default="")
    responsible_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    raw_payload: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    calibrations: Mapped[list["CalibrationRecord"]] = relationship(
        "CalibrationRecord",
        back_populates="equipment",
        cascade="all, delete-orphan",
        order_by="CalibrationRecord.performed_on.desc()",
    )


class CalibrationRecord(Base):
    """Logged verification / calibration run for a piece of equipment."""

    __tablename__ = "calibration_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=new_calibration_id)
    equipment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("equipment_cache.id", ondelete="CASCADE"), index=True
    )
    performed_on: Mapped[date] = mapped_column(Date, index=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    result: Mapped[str] = mapped_column(String(32), default="pass")
    provider_type: Mapped[str] = mapped_column(String(32), default="internal")
    provider_name: Mapped[str] = mapped_column(String(255), default="")
    technician: Mapped[str] = mapped_column(String(255), default="")
    certificate_no: Mapped[str] = mapped_column(String(128), default="")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    equipment: Mapped["EquipmentCache"] = relationship("EquipmentCache", back_populates="calibrations")


class NotificationRecipient(Base):
    """Team member who should receive calibration notification emails (no login)."""

    __tablename__ = "notification_recipients"
    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_recipients_tenant_email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(64), default="member", server_default="member")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # True = customer/org recipient; False = TrueGage staff or external support contacts
    org_member: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AppNotification(Base):
    """Persisted in-app notification inbox item."""

    __tablename__ = "app_notifications"
    __table_args__ = (UniqueConstraint("tenant_id", "source_key", name="uq_notifications_tenant_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=new_notification_id)
    source_key: Mapped[str] = mapped_column(String(128), index=True)
    type: Mapped[str] = mapped_column(String(32), default="reminder", server_default="reminder")
    title: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    event_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    equipment_public_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EmailAuditLog(Base):
    """History of outbound emails (check / overdue alerts)."""

    __tablename__ = "email_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    subject: Mapped[str] = mapped_column(String(512), default="", server_default="")
    to_email: Mapped[str] = mapped_column(String(255), default="")
    to_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    status: Mapped[str] = mapped_column(String(32), default="sent")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    equipment_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    org_member: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
