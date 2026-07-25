"""notification recipients for team email alerts

Revision ID: 003_team_recipients
Revises: 002_standalone_equip
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_team_recipients"
down_revision: Union[str, None] = "002_standalone_equip"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_recipients",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("role", sa.String(length=64), nullable=False, server_default="member"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_notification_recipients_email", "notification_recipients", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_notification_recipients_email", table_name="notification_recipients")
    op.drop_table("notification_recipients")
