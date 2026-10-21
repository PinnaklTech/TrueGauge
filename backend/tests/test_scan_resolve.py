"""Unit tests for scan resolve helpers (no live DB)."""

from __future__ import annotations

from unittest.mock import patch

from app.api import _extract_qr_token_from_code
from app.services.qr_token import generate_qr_token, is_valid_qr_token


def test_extract_bare_token():
    token = generate_qr_token()
    assert _extract_qr_token_from_code(token) == token
    # Uppercase of valid Crockford chars normalizes to lowercase
    assert _extract_qr_token_from_code(token.upper()) == token
    # Forbidden letter i (even lowercased) must not extract
    assert _extract_qr_token_from_code("abcdefghij") is None


def test_extract_url_token_localhost():
    token = generate_qr_token()
    with patch("app.api._allowed_qr_hosts", return_value={"localhost", "app.thetruegage.com"}):
        assert _extract_qr_token_from_code(f"http://localhost:8080/q/{token}") == token
        assert _extract_qr_token_from_code(f"https://app.thetruegage.com/q/{token}") == token


def test_extract_rejects_foreign_host():
    token = generate_qr_token()
    with patch("app.api._allowed_qr_hosts", return_value={"app.thetruegage.com"}):
        assert _extract_qr_token_from_code(f"https://evil.example/q/{token}") is None


def test_extract_rejects_malformed():
    assert _extract_qr_token_from_code("") is None
    assert _extract_qr_token_from_code("not-a-token") is None
    assert _extract_qr_token_from_code("https://app.thetruegage.com/equipment/eq-abc") is None


def test_is_valid_helpers():
    t = generate_qr_token()
    assert is_valid_qr_token(t)
    assert not is_valid_qr_token("i" * 10)  # forbidden letter
