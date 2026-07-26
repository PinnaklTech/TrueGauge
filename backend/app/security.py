"""Password hashing and signed auth tokens (no extra JWT dependency)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Any, Optional

from cryptography.fernet import Fernet

from app.config import get_settings

logger = logging.getLogger(__name__)

# Legacy PBKDF2 (upgraded on successful login)
LEGACY_PBKDF2_ITERATIONS = 120_000
PBKDF2_ITERATIONS = 600_000

# Dummy hash for constant-time login when user is missing
_DUMMY_PASSWORD_HASH = (
    "pbkdf2_sha256$600000$0123456789abcdef0123456789abcdef$"
    + ("0" * 64)
)


def _fernet() -> Fernet:
    digest = hashlib.sha256(get_settings().fernet_secret.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")


def hash_password(password: str) -> str:
    """Hash with Argon2id when available, else strong PBKDF2-SHA256."""
    try:
        from argon2 import PasswordHasher

        ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
        return f"argon2id${ph.hash(password)}"
    except ImportError:
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            PBKDF2_ITERATIONS,
        ).hex()
        return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def needs_rehash(stored: str) -> bool:
    if stored.startswith("argon2id$"):
        return False
    if stored.startswith("pbkdf2_sha256$"):
        try:
            iters = int(stored.split("$", 3)[1])
        except (IndexError, ValueError):
            return True
        return iters < PBKDF2_ITERATIONS
    return True


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("argon2id$"):
        try:
            from argon2 import PasswordHasher
            from argon2.exceptions import VerifyMismatchError

            ph = PasswordHasher()
            encoded = stored[len("argon2id$") :]
            try:
                return bool(ph.verify(encoded, password))
            except VerifyMismatchError:
                return False
        except ImportError:
            return False

    try:
        algo, iters_s, salt, digest = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_s)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iters,
    ).hex()
    return hmac.compare_digest(check, digest)


def verify_password_with_dummy(password: str, stored: Optional[str]) -> bool:
    """Verify against stored hash, or a dummy hash when user is missing (timing)."""
    if stored is None:
        verify_password(password, _DUMMY_PASSWORD_HASH)
        return False
    return verify_password(password, stored)


def _signing_key() -> bytes:
    # Dedicated purpose string so signing material differs from Fernet key derivation
    material = f"tg-access-v1:{get_settings().secret_key}".encode("utf-8")
    return hashlib.sha256(material).digest()


def create_access_token(
    *,
    user_id: int,
    email: str,
    tenant_id: int,
    role: str,
    token_version: int = 0,
) -> str:
    settings = get_settings()
    payload = {
        "sub": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "role": role,
        "ver": int(token_version),
        "exp": int(time.time()) + int(settings.access_token_ttl_seconds),
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode(
        "utf-8"
    )
    sig = hmac.new(_signing_key(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    try:
        raw, sig = token.rsplit(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_signing_key(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(raw.encode("utf-8")).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        return None
    if "sub" not in payload:
        return None
    return payload


def hash_opaque_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def client_safe_error(exc: BaseException, *, fallback: str = "Request failed") -> str:
    """Return a generic client message; log the real exception server-side."""
    logger.warning("Outbound integration error: %s", exc, exc_info=False)
    return fallback
