"""SMTP / email delivery settings on settings table

Revision ID: 004_email_smtp
Revises: 003_team_recipients
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_email_smtp"
down_revision: Union[str, None] = "003_team_recipients"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("settings", sa.Column("smtp_host", sa.String(length=255), nullable=True))
    op.add_column("settings", sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587"))
    op.add_column("settings", sa.Column("smtp_username", sa.String(length=255), nullable=True))
    op.add_column("settings", sa.Column("smtp_password_encrypted", sa.Text(), nullable=True))
    op.add_column("settings", sa.Column("smtp_use_tls", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("settings", sa.Column("smtp_from_email", sa.String(length=255), nullable=True))
    op.add_column("settings", sa.Column("smtp_from_name", sa.String(length=255), nullable=True))
    op.add_column("settings", sa.Column("smtp_last_error", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("settings", "smtp_last_error")
    op.drop_column("settings", "smtp_from_name")
    op.drop_column("settings", "smtp_from_email")
    op.drop_column("settings", "smtp_use_tls")
    op.drop_column("settings", "smtp_password_encrypted")
    op.drop_column("settings", "smtp_username")
    op.drop_column("settings", "smtp_port")
    op.drop_column("settings", "smtp_host")
