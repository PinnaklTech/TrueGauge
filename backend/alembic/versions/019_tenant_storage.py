"""Tenant certificate vault feature flag.

Revision ID: 019_tenant_storage
Revises: 018_certificates_r2
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "019_tenant_storage"
down_revision = "018_certificates_r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "storage_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Keep vault on for companies that already uploaded certificates.
    op.execute(
        """
        UPDATE tenants
        SET storage_enabled = true
        WHERE id IN (SELECT DISTINCT tenant_id FROM certificates)
        """
    )


def downgrade() -> None:
    op.drop_column("tenants", "storage_enabled")
