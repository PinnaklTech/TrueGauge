"""Reminder engine: rules on settings + jobs + dispatch ledger

Revision ID: 015_reminder_engine
Revises: 014_notification_reads
Create Date: 2026-07-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015_reminder_engine"
down_revision: Union[str, None] = "014_notification_reads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column("remind_30d", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "settings",
        sa.Column("remind_14d", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "settings",
        sa.Column("remind_7d", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "settings",
        sa.Column("remind_1d", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "settings",
        sa.Column("remind_overdue_daily", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "settings",
        sa.Column("remind_weekly_digest", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "settings",
        sa.Column("reminder_hour_local", sa.Integer(), nullable=False, server_default="8"),
    )

    op.create_table(
        "reminder_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("job_kind", sa.String(length=32), nullable=False),
        sa.Column("job_date_local", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "job_kind", "job_date_local", name="uq_reminder_jobs_tenant_kind_date"),
    )
    op.create_index("ix_reminder_jobs_tenant_id", "reminder_jobs", ["tenant_id"])
    op.create_index("ix_reminder_jobs_status", "reminder_jobs", ["status"])
    op.create_index("ix_reminder_jobs_job_date_local", "reminder_jobs", ["job_date_local"])

    op.create_table(
        "reminder_dispatches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("period_key", sa.String(length=255), nullable=False),
        sa.Column("recipient_key", sa.String(length=255), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("equipment_public_id", sa.String(length=64), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "kind",
            "period_key",
            "recipient_key",
            "channel",
            name="uq_reminder_dispatches_unique",
        ),
    )
    op.create_index("ix_reminder_dispatches_tenant_id", "reminder_dispatches", ["tenant_id"])
    op.create_index("ix_reminder_dispatches_kind", "reminder_dispatches", ["kind"])
    op.create_index("ix_reminder_dispatches_status", "reminder_dispatches", ["status"])


def downgrade() -> None:
    op.drop_table("reminder_dispatches")
    op.drop_table("reminder_jobs")
    op.drop_column("settings", "reminder_hour_local")
    op.drop_column("settings", "remind_weekly_digest")
    op.drop_column("settings", "remind_overdue_daily")
    op.drop_column("settings", "remind_1d")
    op.drop_column("settings", "remind_7d")
    op.drop_column("settings", "remind_14d")
    op.drop_column("settings", "remind_30d")
