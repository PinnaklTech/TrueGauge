"""Org taxonomy lists (departments, categories, locations)

Revision ID: 012_org_taxonomy
Revises: 011_auth_events
Create Date: 2026-07-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_org_taxonomy"
down_revision: Union[str, None] = "011_auth_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT = '{"departments":[],"categories":[],"locations":[]}'


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column(
            "taxonomy_json",
            sa.Text(),
            nullable=False,
            server_default=_DEFAULT,
        ),
    )


def downgrade() -> None:
    op.drop_column("settings", "taxonomy_json")
