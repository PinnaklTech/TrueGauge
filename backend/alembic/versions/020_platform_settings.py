"""Platform settings singleton (system SMTP).

Revision ID: 020_platform_settings
Revises: 019_tenant_storage
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "020_platform_settings"
down_revision = "019_tenant_storage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("smtp_host", sa.String(length=255), nullable=True),
        sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("smtp_username", sa.String(length=255), nullable=True),
        sa.Column("smtp_password_encrypted", sa.Text(), nullable=True),
        sa.Column("smtp_use_tls", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("smtp_from_email", sa.String(length=255), nullable=True),
        sa.Column("smtp_from_name", sa.String(length=255), nullable=False, server_default="TrueGage"),
        sa.Column("smtp_last_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.execute("INSERT INTO platform_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table("platform_settings")
