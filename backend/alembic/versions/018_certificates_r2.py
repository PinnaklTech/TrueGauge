"""PDF certificates stored in Cloudflare R2.

Revision ID: 018_certificates_r2
Revises: 017_reminders_opt_in
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "018_certificates_r2"
down_revision = "017_reminders_opt_in"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "certificates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("equipment_id", sa.Integer(), nullable=False),
        sa.Column("calibration_id", sa.Integer(), nullable=True),
        sa.Column("object_key", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column(
            "content_type",
            sa.String(length=128),
            nullable=False,
            server_default="application/pdf",
        ),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["calibration_id"], ["calibration_records.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["equipment_id"], ["equipment_cache.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_certificates_tenant_id", "certificates", ["tenant_id"])
    op.create_index("ix_certificates_public_id", "certificates", ["public_id"], unique=True)
    op.create_index("ix_certificates_equipment_id", "certificates", ["equipment_id"])
    op.create_index("ix_certificates_calibration_id", "certificates", ["calibration_id"])
    op.create_index("ix_certificates_status", "certificates", ["status"])
    op.create_index("ix_certificates_uploaded_by_user_id", "certificates", ["uploaded_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_certificates_uploaded_by_user_id", table_name="certificates")
    op.drop_index("ix_certificates_status", table_name="certificates")
    op.drop_index("ix_certificates_calibration_id", table_name="certificates")
    op.drop_index("ix_certificates_equipment_id", table_name="certificates")
    op.drop_index("ix_certificates_public_id", table_name="certificates")
    op.drop_index("ix_certificates_tenant_id", table_name="certificates")
    op.drop_table("certificates")
