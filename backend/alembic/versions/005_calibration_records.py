"""Calibration records timeline per equipment

Revision ID: 005_calibration_records
Revises: 004_email_smtp
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_calibration_records"
down_revision: Union[str, None] = "004_email_smtp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calibration_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("equipment_id", sa.Integer(), nullable=False),
        sa.Column("performed_on", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("result", sa.String(length=32), nullable=False, server_default="pass"),
        sa.Column("provider_type", sa.String(length=32), nullable=False, server_default="internal"),
        sa.Column("provider_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("technician", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("certificate_no", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["equipment_id"], ["equipment_cache.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calibration_records_public_id", "calibration_records", ["public_id"], unique=True)
    op.create_index("ix_calibration_records_equipment_id", "calibration_records", ["equipment_id"])
    op.create_index("ix_calibration_records_performed_on", "calibration_records", ["performed_on"])


def downgrade() -> None:
    op.drop_index("ix_calibration_records_performed_on", table_name="calibration_records")
    op.drop_index("ix_calibration_records_equipment_id", table_name="calibration_records")
    op.drop_index("ix_calibration_records_public_id", table_name="calibration_records")
    op.drop_table("calibration_records")
