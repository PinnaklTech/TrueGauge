"""Store last few generated PDF reports in Postgres.

Revision ID: 023_generated_reports
Revises: 022_org_regional_settings
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "023_generated_reports"
down_revision = "022_org_regional_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "generated_reports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("report_id", sa.String(length=64), nullable=False),
        sa.Column(
            "report_type",
            sa.String(length=32),
            nullable=False,
            server_default="compliance",
        ),
        sa.Column("filename", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("generated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("generated_by_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("generated_by_role", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("meta_json", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["generated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "report_id", name="uq_generated_reports_tenant_report_id"),
    )
    op.create_index("ix_generated_reports_tenant_id", "generated_reports", ["tenant_id"])
    op.create_index("ix_generated_reports_report_id", "generated_reports", ["report_id"])
    op.create_index(
        "ix_generated_reports_generated_by_user_id",
        "generated_reports",
        ["generated_by_user_id"],
    )
    op.create_index("ix_generated_reports_created_at", "generated_reports", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_generated_reports_created_at", table_name="generated_reports")
    op.drop_index("ix_generated_reports_generated_by_user_id", table_name="generated_reports")
    op.drop_index("ix_generated_reports_report_id", table_name="generated_reports")
    op.drop_index("ix_generated_reports_tenant_id", table_name="generated_reports")
    op.drop_table("generated_reports")
