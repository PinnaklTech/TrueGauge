"""Org-wide regional display + notification preference fields.

Revision ID: 022_org_regional_settings
Revises: 021_equipment_qr_token
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "022_org_regional_settings"
down_revision = "021_equipment_qr_token"
branch_labels = None
depends_on = None

LEGACY_TZ = {
    "utc": "UTC",
    "cst": "America/Chicago",
    "et": "America/New_York",
    "est": "America/New_York",
    "pt": "America/Los_Angeles",
    "pst": "America/Los_Angeles",
    "london": "Europe/London",
    "gmt": "Europe/London",
    "bst": "Europe/London",
    "ist": "Asia/Kolkata",
    "india": "Asia/Kolkata",
    "asia/calcutta": "Asia/Kolkata",
}


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column("date_format", sa.String(length=32), nullable=False, server_default="DD MMM YYYY"),
    )
    op.add_column(
        "settings",
        sa.Column("time_format", sa.String(length=8), nullable=False, server_default="12h"),
    )
    op.add_column(
        "settings",
        sa.Column("week_start", sa.String(length=16), nullable=False, server_default="monday"),
    )
    op.add_column(
        "settings",
        sa.Column(
            "reminder_skip_weekends",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "settings",
        sa.Column(
            "allow_user_display_override",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "settings",
        sa.Column(
            "allow_user_channel_toggle",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    op.add_column("users", sa.Column("timezone_override", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("date_format_override", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("time_format_override", sa.String(length=8), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT tenant_id, timezone FROM settings")).fetchall()
    for tenant_id, tz in rows:
        key = (tz or "UTC").strip()
        mapped = LEGACY_TZ.get(key.casefold(), key)
        if mapped != tz:
            conn.execute(
                sa.text("UPDATE settings SET timezone = :tz WHERE tenant_id = :tid"),
                {"tz": mapped, "tid": tenant_id},
            )

    user_rows = conn.execute(sa.text("SELECT id, timezone FROM users")).fetchall()
    for uid, tz in user_rows:
        key = (tz or "UTC").strip()
        mapped = LEGACY_TZ.get(key.casefold(), key)
        if mapped != tz:
            conn.execute(
                sa.text("UPDATE users SET timezone = :tz WHERE id = :uid"),
                {"tz": mapped, "uid": uid},
            )


def downgrade() -> None:
    op.drop_column("users", "time_format_override")
    op.drop_column("users", "date_format_override")
    op.drop_column("users", "timezone_override")
    op.drop_column("settings", "allow_user_channel_toggle")
    op.drop_column("settings", "allow_user_display_override")
    op.drop_column("settings", "reminder_skip_weekends")
    op.drop_column("settings", "week_start")
    op.drop_column("settings", "time_format")
    op.drop_column("settings", "date_format")
