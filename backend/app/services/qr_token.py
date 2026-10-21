"""Crockford-style opaque QR tokens for equipment labels."""

from __future__ import annotations

import secrets

from sqlalchemy.orm import Session

# 32 chars — no i, l, o, u (Crockford-style, lowercase)
QR_TOKEN_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
QR_TOKEN_LENGTH = 10
QR_TOKEN_MAX_ATTEMPTS = 5


def generate_qr_token(length: int = QR_TOKEN_LENGTH) -> str:
    """Return a cryptographically random token using rejection sampling (no modulo bias)."""
    alphabet = QR_TOKEN_ALPHABET
    alphabet_len = len(alphabet)
    # Largest multiple of alphabet_len that fits in a byte
    limit = 256 - (256 % alphabet_len)
    out: list[str] = []
    while len(out) < length:
        for byte in secrets.token_bytes(length - len(out) + 8):
            if byte >= limit:
                continue
            out.append(alphabet[byte % alphabet_len])
            if len(out) >= length:
                break
    return "".join(out)


def allocate_qr_token(db: Session, *, model_cls, column_attr, max_attempts: int = QR_TOKEN_MAX_ATTEMPTS) -> str:
    """Generate a unique token, checking the DB for collisions before insert."""
    for _ in range(max_attempts):
        token = generate_qr_token()
        exists = db.query(model_cls.id).filter(column_attr == token).first()
        if exists is None:
            return token
    raise RuntimeError(f"Failed to allocate unique qr_token after {max_attempts} attempts")


def is_valid_qr_token(value: str) -> bool:
    if len(value) != QR_TOKEN_LENGTH:
        return False
    alphabet_set = set(QR_TOKEN_ALPHABET)
    return all(ch in alphabet_set for ch in value)
