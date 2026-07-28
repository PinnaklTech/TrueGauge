"""Reminders and user notify prefs default off (opt-in)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "017_reminders_opt_in"
down_revision = "016_user_onboarding"
branch_labels = None
depends_on = None

REMIND_COLS = (
    "remind_30d",
    "remind_14d",
    "remind_7d",
    "remind_1d",
    "remind_overdue_daily",
)


def upgrade() -> None:
    # New workspaces / users start with alerts off; existing rows keep current values.
    for col in REMIND_COLS:
        op.alter_column(
            "settings",
            col,
            existing_type=sa.Boolean(),
            server_default="false",
            existing_nullable=False,
        )
    op.alter_column(
        "users",
        "notify_email",
        existing_type=sa.Boolean(),
        server_default="false",
        existing_nullable=False,
    )
    op.alter_column(
        "users",
        "notify_in_app",
        existing_type=sa.Boolean(),
        server_default="false",
        existing_nullable=False,
    )


def downgrade() -> None:
    for col in REMIND_COLS:
        op.alter_column(
            "settings",
            col,
            existing_type=sa.Boolean(),
            server_default="true",
            existing_nullable=False,
        )
    op.alter_column(
        "users",
        "notify_email",
        existing_type=sa.Boolean(),
        server_default="true",
        existing_nullable=False,
    )
    op.alter_column(
        "users",
        "notify_in_app",
        existing_type=sa.Boolean(),
        server_default="true",
        existing_nullable=False,
    )
