"""Per-user notification read state

Revision ID: 014_notification_reads
Revises: 013_audit_events
Create Date: 2026-07-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014_notification_reads"
down_revision: Union[str, None] = "013_audit_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_reads",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("notification_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["notification_id"], ["app_notifications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "notification_id", name="uq_notification_reads_user_notif"),
    )
    op.create_index("ix_notification_reads_user_id", "notification_reads", ["user_id"])
    op.create_index("ix_notification_reads_notification_id", "notification_reads", ["notification_id"])


def downgrade() -> None:
    op.drop_table("notification_reads")
