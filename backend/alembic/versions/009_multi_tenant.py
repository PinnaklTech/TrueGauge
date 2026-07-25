"""Multi-tenant company separation

Revision ID: 009_multi_tenant
Revises: 008_email_audit_org_member
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_multi_tenant"
down_revision: Union[str, None] = "008_email_audit_org_member"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"])

    # Seed default tenant from existing company name (if any)
    op.execute(
        """
        INSERT INTO tenants (id, slug, name, active)
        VALUES (
          1,
          'default',
          COALESCE(
            NULLIF((SELECT company_name FROM settings WHERE id = 1 LIMIT 1), ''),
            'Default Workspace'
          ),
          true
        )
        """
    )
    op.execute("SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT MAX(id) FROM tenants), 1))")

    op.create_table(
        "tenant_memberships",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "tenant_id", name="uq_tenant_memberships_user_tenant"),
    )
    op.create_index("ix_tenant_memberships_user_id", "tenant_memberships", ["user_id"])
    op.create_index("ix_tenant_memberships_tenant_id", "tenant_memberships", ["tenant_id"])

    # settings: add tenant_id, drop hard-coded singleton assumption
    op.add_column("settings", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute("UPDATE settings SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column("settings", "tenant_id", nullable=False)
    op.create_unique_constraint("uq_settings_tenant_id", "settings", ["tenant_id"])
    op.create_foreign_key("fk_settings_tenant_id", "settings", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_settings_tenant_id", "settings", ["tenant_id"])
    # Old singleton used id=1 without advancing a sequence — fix before new tenants
    op.execute(
        "SELECT setval(pg_get_serial_sequence('settings', 'id'), "
        "GREATEST(COALESCE((SELECT MAX(id) FROM settings), 1), 1))"
    )

    # users
    op.add_column("users", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute("UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.create_foreign_key("fk_users_tenant_id", "users", "tenants", ["tenant_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    # Promote True Gauge admin to platform_admin with membership
    op.execute(
        """
        UPDATE users
        SET role = 'platform_admin', tenant_id = NULL
        WHERE lower(email) IN ('admin@truegauge.com', 'admin@truegauge.local')
        """
    )
    op.execute(
        """
        INSERT INTO tenant_memberships (user_id, tenant_id)
        SELECT id, 1 FROM users WHERE role = 'platform_admin'
        ON CONFLICT DO NOTHING
        """
    )

    # equipment_cache
    op.add_column("equipment_cache", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute("UPDATE equipment_cache SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column("equipment_cache", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_equipment_cache_tenant_id", "equipment_cache", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_equipment_cache_tenant_id", "equipment_cache", ["tenant_id"])
    op.drop_constraint("equipment_cache_odoo_id_key", "equipment_cache", type_="unique")
    op.create_unique_constraint("uq_equipment_tenant_odoo", "equipment_cache", ["tenant_id", "odoo_id"])

    # calibration_records
    op.add_column("calibration_records", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE calibration_records AS c
        SET tenant_id = e.tenant_id
        FROM equipment_cache AS e
        WHERE c.equipment_id = e.id AND c.tenant_id IS NULL
        """
    )
    op.execute("UPDATE calibration_records SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column("calibration_records", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_calibration_records_tenant_id",
        "calibration_records",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_calibration_records_tenant_id", "calibration_records", ["tenant_id"])

    # notification_recipients
    op.add_column("notification_recipients", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute("UPDATE notification_recipients SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column("notification_recipients", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_notification_recipients_tenant_id",
        "notification_recipients",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_notification_recipients_tenant_id", "notification_recipients", ["tenant_id"])
    op.drop_constraint("notification_recipients_email_key", "notification_recipients", type_="unique")
    op.create_unique_constraint("uq_recipients_tenant_email", "notification_recipients", ["tenant_id", "email"])

    # app_notifications
    op.add_column("app_notifications", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute("UPDATE app_notifications SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column("app_notifications", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_app_notifications_tenant_id",
        "app_notifications",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_app_notifications_tenant_id", "app_notifications", ["tenant_id"])
    op.drop_index("ix_app_notifications_source_key", table_name="app_notifications")
    op.create_index("ix_app_notifications_source_key", "app_notifications", ["source_key"], unique=False)
    op.create_unique_constraint("uq_notifications_tenant_source", "app_notifications", ["tenant_id", "source_key"])

    # email_audit_log
    op.add_column("email_audit_log", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.execute("UPDATE email_audit_log SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column("email_audit_log", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_email_audit_log_tenant_id", "email_audit_log", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_email_audit_log_tenant_id", "email_audit_log", ["tenant_id"])


def downgrade() -> None:
    op.drop_constraint("fk_email_audit_log_tenant_id", "email_audit_log", type_="foreignkey")
    op.drop_index("ix_email_audit_log_tenant_id", table_name="email_audit_log")
    op.drop_column("email_audit_log", "tenant_id")

    op.drop_constraint("uq_notifications_tenant_source", "app_notifications", type_="unique")
    op.drop_constraint("fk_app_notifications_tenant_id", "app_notifications", type_="foreignkey")
    op.drop_index("ix_app_notifications_tenant_id", table_name="app_notifications")
    op.drop_index("ix_app_notifications_source_key", table_name="app_notifications")
    op.drop_column("app_notifications", "tenant_id")
    op.create_index("ix_app_notifications_source_key", "app_notifications", ["source_key"], unique=True)

    op.drop_constraint("uq_recipients_tenant_email", "notification_recipients", type_="unique")
    op.drop_constraint("fk_notification_recipients_tenant_id", "notification_recipients", type_="foreignkey")
    op.drop_index("ix_notification_recipients_tenant_id", table_name="notification_recipients")
    op.drop_column("notification_recipients", "tenant_id")
    op.create_unique_constraint("notification_recipients_email_key", "notification_recipients", ["email"])

    op.drop_constraint("fk_calibration_records_tenant_id", "calibration_records", type_="foreignkey")
    op.drop_index("ix_calibration_records_tenant_id", table_name="calibration_records")
    op.drop_column("calibration_records", "tenant_id")

    op.drop_constraint("uq_equipment_tenant_odoo", "equipment_cache", type_="unique")
    op.drop_constraint("fk_equipment_cache_tenant_id", "equipment_cache", type_="foreignkey")
    op.drop_index("ix_equipment_cache_tenant_id", table_name="equipment_cache")
    op.drop_column("equipment_cache", "tenant_id")
    op.create_unique_constraint("equipment_cache_odoo_id_key", "equipment_cache", ["odoo_id"])

    op.drop_constraint("fk_users_tenant_id", "users", type_="foreignkey")
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_column("users", "tenant_id")

    op.drop_constraint("fk_settings_tenant_id", "settings", type_="foreignkey")
    op.drop_constraint("uq_settings_tenant_id", "settings", type_="unique")
    op.drop_index("ix_settings_tenant_id", table_name="settings")
    op.drop_column("settings", "tenant_id")

    op.drop_table("tenant_memberships")
    op.drop_table("tenants")
