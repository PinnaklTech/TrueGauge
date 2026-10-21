"""Add globally unique qr_token to equipment_cache.

Revision ID: 021_equipment_qr_token
Revises: 020_platform_settings
"""

from __future__ import annotations

import secrets

import sqlalchemy as sa
from alembic import op

revision = "021_equipment_qr_token"
down_revision = "020_platform_settings"
branch_labels = None
depends_on = None

QR_TOKEN_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
QR_TOKEN_LENGTH = 10
BATCH_SIZE = 500


def _generate_token() -> str:
    alphabet = QR_TOKEN_ALPHABET
    alphabet_len = len(alphabet)
    limit = 256 - (256 % alphabet_len)
    out: list[str] = []
    while len(out) < QR_TOKEN_LENGTH:
        for byte in secrets.token_bytes(QR_TOKEN_LENGTH - len(out) + 8):
            if byte >= limit:
                continue
            out.append(alphabet[byte % alphabet_len])
            if len(out) >= QR_TOKEN_LENGTH:
                break
    return "".join(out)


def upgrade() -> None:
    op.add_column("equipment_cache", sa.Column("qr_token", sa.String(length=16), nullable=True))
    op.add_column(
        "equipment_cache",
        sa.Column("qr_token_regenerated_at", sa.DateTime(timezone=True), nullable=True),
    )

    conn = op.get_bind()
    used: set[str] = set()

    while True:
        rows = conn.execute(
            sa.text(
                "SELECT id FROM equipment_cache WHERE qr_token IS NULL ORDER BY id LIMIT :lim"
            ),
            {"lim": BATCH_SIZE},
        ).fetchall()
        if not rows:
            break
        for (row_id,) in rows:
            token = _generate_token()
            while token in used:
                token = _generate_token()
            used.add(token)
            # Retry on rare unique collision with already-persisted tokens
            for _ in range(5):
                try:
                    with conn.begin_nested():
                        conn.execute(
                            sa.text(
                                "UPDATE equipment_cache SET qr_token = :token WHERE id = :id"
                            ),
                            {"token": token, "id": row_id},
                        )
                    break
                except Exception:
                    token = _generate_token()
                    while token in used:
                        token = _generate_token()
                    used.add(token)
            else:
                raise RuntimeError(f"Could not assign qr_token for equipment id={row_id}")

    op.alter_column("equipment_cache", "qr_token", nullable=False)
    op.create_index("ix_equipment_cache_qr_token", "equipment_cache", ["qr_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_equipment_cache_qr_token", table_name="equipment_cache")
    op.drop_column("equipment_cache", "qr_token_regenerated_at")
    op.drop_column("equipment_cache", "qr_token")
