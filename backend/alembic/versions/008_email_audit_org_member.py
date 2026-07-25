"""Store org_member on email audit log for visibility filtering

Revision ID: 008_email_audit_org_member
Revises: 007_team_org_member
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_email_audit_org_member"
down_revision: Union[str, None] = "007_team_org_member"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "email_audit_log",
        sa.Column("org_member", sa.Boolean(), nullable=False, server_default="true"),
    )
    # Backfill from current team roster (non-org recipients stay hidden from normal users)
    op.execute(
        """
        UPDATE email_audit_log AS e
        SET org_member = COALESCE(
          (
            SELECT r.org_member
            FROM notification_recipients AS r
            WHERE lower(r.email) = lower(e.to_email)
            LIMIT 1
          ),
          true
        )
        """
    )


def downgrade() -> None:
    op.drop_column("email_audit_log", "org_member")
