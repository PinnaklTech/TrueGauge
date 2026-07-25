"""equipment public_id source nullable odoo_id

Revision ID: 002_standalone_equip
Revises: 001_initial
Create Date: 2026-07-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_standalone_equip"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("equipment_cache", sa.Column("public_id", sa.String(length=64), nullable=True))
    op.add_column(
        "equipment_cache",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="odoo"),
    )

    # Backfill existing Odoo-imported rows
    op.execute(
        """
        UPDATE equipment_cache
        SET public_id = 'eq-' || odoo_id::text,
            source = 'odoo'
        WHERE public_id IS NULL
        """
    )

    op.alter_column("equipment_cache", "public_id", nullable=False)
    op.create_index("ix_equipment_cache_public_id", "equipment_cache", ["public_id"], unique=True)
    op.create_index("ix_equipment_cache_source", "equipment_cache", ["source"])

    # Allow local equipment without an Odoo id
    op.alter_column("equipment_cache", "odoo_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Remove local-only rows before making odoo_id required again
    op.execute("DELETE FROM equipment_cache WHERE odoo_id IS NULL")
    op.alter_column("equipment_cache", "odoo_id", existing_type=sa.Integer(), nullable=False)
    op.drop_index("ix_equipment_cache_source", table_name="equipment_cache")
    op.drop_index("ix_equipment_cache_public_id", table_name="equipment_cache")
    op.drop_column("equipment_cache", "source")
    op.drop_column("equipment_cache", "public_id")
