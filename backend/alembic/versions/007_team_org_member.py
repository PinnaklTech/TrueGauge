"""Add org_member flag to notification recipients

Revision ID: 007_team_org_member
Revises: 006_users_org_notif_audit
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_team_org_member"
down_revision: Union[str, None] = "006_users_org_notif_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification_recipients",
        sa.Column("org_member", sa.Boolean(), nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("notification_recipients", "org_member")
