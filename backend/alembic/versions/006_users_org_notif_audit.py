"""Users, org profile, notifications inbox, email audit

Revision ID: 006_users_org_notif_audit
Revises: 005_calibration_records
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_users_org_notif_audit"
down_revision: Union[str, None] = "005_calibration_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("settings", sa.Column("company_name", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("settings", sa.Column("industry", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("settings", sa.Column("address", sa.Text(), nullable=True))
    op.add_column("settings", sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"))
    op.add_column(
        "settings",
        sa.Column("accent_color", sa.String(length=32), nullable=False, server_default="#0f766e"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("job_title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("department", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("phone", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("role", sa.String(length=64), nullable=False, server_default="admin"),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("locale", sa.String(length=32), nullable=False, server_default="en-US"),
        sa.Column("notify_email", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_in_app", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "app_notifications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("source_key", sa.String(length=128), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False, server_default="reminder"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("event_date", sa.String(length=32), nullable=True),
        sa.Column("read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("equipment_public_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_app_notifications_public_id", "app_notifications", ["public_id"], unique=True)
    op.create_index("ix_app_notifications_source_key", "app_notifications", ["source_key"], unique=True)
    op.create_index("ix_app_notifications_read", "app_notifications", ["read"])

    op.create_table(
        "email_audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("to_email", sa.String(length=255), nullable=False),
        sa.Column("to_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("equipment_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_audit_log_kind", "email_audit_log", ["kind"])
    op.create_index("ix_email_audit_log_created_at", "email_audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_email_audit_log_created_at", table_name="email_audit_log")
    op.drop_index("ix_email_audit_log_kind", table_name="email_audit_log")
    op.drop_table("email_audit_log")

    op.drop_index("ix_app_notifications_read", table_name="app_notifications")
    op.drop_index("ix_app_notifications_source_key", table_name="app_notifications")
    op.drop_index("ix_app_notifications_public_id", table_name="app_notifications")
    op.drop_table("app_notifications")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    op.drop_column("settings", "accent_color")
    op.drop_column("settings", "timezone")
    op.drop_column("settings", "address")
    op.drop_column("settings", "industry")
    op.drop_column("settings", "company_name")
