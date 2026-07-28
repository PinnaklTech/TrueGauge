"""User first-login onboarding flags

Revision ID: 016_user_onboarding
Revises: 015_reminder_engine
Create Date: 2026-07-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016_user_onboarding"
down_revision: Union[str, None] = "015_reminder_engine"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("profile_setup_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("product_tour_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing accounts: do not interrupt with onboarding
    op.execute(
        sa.text(
            "UPDATE users SET profile_setup_at = COALESCE(created_at, NOW()), "
            "product_tour_at = COALESCE(created_at, NOW()) "
            "WHERE profile_setup_at IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("users", "product_tour_at")
    op.drop_column("users", "profile_setup_at")
