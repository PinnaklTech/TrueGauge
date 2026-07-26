"""Security-focused unit tests (no live DB required for these)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.security import (
    create_access_token,
    decode_access_token,
    hash_opaque_token,
    hash_password,
    needs_rehash,
    verify_password,
    verify_password_with_dummy,
)
from app.ssrf import validate_public_https_url, validate_smtp_host


def test_password_roundtrip_and_rehash_flag():
    hashed = hash_password("CorrectHorseBattery!")
    assert verify_password("CorrectHorseBattery!", hashed)
    assert not verify_password("wrong", hashed)
    # Fresh hashes should not need rehash
    assert needs_rehash(hashed) is False


def test_legacy_pbkdf2_needs_rehash():
    legacy = (
        "pbkdf2_sha256$120000$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$"
        + ("b" * 64)
    )
    assert needs_rehash(legacy) is True


def test_dummy_verify_when_user_missing():
    assert verify_password_with_dummy("anything", None) is False


def test_access_token_includes_version():
    token = create_access_token(
        user_id=1,
        email="a@b.com",
        tenant_id=2,
        role="admin",
        token_version=7,
    )
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == 1
    assert payload["tenant_id"] == 2
    assert payload["ver"] == 7


def test_opaque_token_hash_stable():
    assert hash_opaque_token("abc") == hash_opaque_token("abc")
    assert hash_opaque_token("abc") != hash_opaque_token("abd")


def test_ssrf_blocks_localhost_http():
    with pytest.raises(HTTPException) as ei:
        validate_public_https_url("http://example.com", field_name="Odoo URL")
    assert ei.value.status_code == 400

    with pytest.raises(HTTPException):
        validate_public_https_url("https://127.0.0.1/xmlrpc", field_name="Odoo URL")

    with pytest.raises(HTTPException):
        validate_smtp_host("127.0.0.1")

    with pytest.raises(HTTPException):
        validate_smtp_host("localhost")


def test_ssrf_blocks_private_literal():
    with pytest.raises(HTTPException):
        validate_smtp_host("10.0.0.5")
