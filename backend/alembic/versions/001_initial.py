"""initial settings + equipment_cache

Revision ID: 001_initial
Revises:
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("odoo_url", sa.String(length=512), nullable=True),
        sa.Column("odoo_database", sa.String(length=255), nullable=True),
        sa.Column("odoo_username", sa.String(length=255), nullable=True),
        sa.Column("odoo_api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("odoo_connected", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("odoo_last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("odoo_last_error", sa.Text(), nullable=True),
        sa.Column("field_calibration_date", sa.String(length=128), nullable=True),
        sa.Column("field_calibration_due", sa.String(length=128), nullable=True),
        sa.Column("field_responsible_email", sa.String(length=128), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "equipment_cache",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("odoo_id", sa.Integer(), nullable=False),
        sa.Column("tag", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=255), nullable=False),
        sa.Column("manufacturer", sa.String(length=255), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False),
        sa.Column("serial", sa.String(length=255), nullable=False),
        sa.Column("department", sa.String(length=255), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("last_calibration", sa.Date(), nullable=True),
        sa.Column("next_calibration", sa.Date(), nullable=True),
        sa.Column("frequency_days", sa.Integer(), nullable=False),
        sa.Column("owner", sa.String(length=255), nullable=False),
        sa.Column("responsible_email", sa.String(length=255), nullable=True),
        sa.Column("raw_payload", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("odoo_id"),
    )
    op.create_index("ix_equipment_cache_odoo_id", "equipment_cache", ["odoo_id"])
    op.create_index("ix_equipment_cache_tag", "equipment_cache", ["tag"])
    op.create_index("ix_equipment_cache_status", "equipment_cache", ["status"])


def downgrade() -> None:
    op.drop_index("ix_equipment_cache_status", table_name="equipment_cache")
    op.drop_index("ix_equipment_cache_tag", table_name="equipment_cache")
    op.drop_index("ix_equipment_cache_odoo_id", table_name="equipment_cache")
    op.drop_table("equipment_cache")
    op.drop_table("settings")
