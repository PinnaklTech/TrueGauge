"""Unit tests for QR token generation (no DB required)."""

from __future__ import annotations

from collections import Counter

from app.services.qr_token import (
    QR_TOKEN_ALPHABET,
    QR_TOKEN_LENGTH,
    generate_qr_token,
    is_valid_qr_token,
)


def test_token_length_and_alphabet():
    for _ in range(50):
        token = generate_qr_token()
        assert len(token) == QR_TOKEN_LENGTH
        assert is_valid_qr_token(token)
        assert all(ch in QR_TOKEN_ALPHABET for ch in token)


def test_forbidden_chars_absent():
    forbidden = set("ilouILOU")
    for _ in range(100):
        token = generate_qr_token()
        assert not (set(token) & forbidden)


def test_tokens_are_unique_in_batch():
    tokens = {generate_qr_token() for _ in range(500)}
    assert len(tokens) == 500


def test_rejection_sampling_uses_full_alphabet():
    """Over many draws, every alphabet char should appear (no obvious bias holes)."""
    counts: Counter[str] = Counter()
    for _ in range(2000):
        counts.update(generate_qr_token())
    for ch in QR_TOKEN_ALPHABET:
        assert counts[ch] > 0, f"character {ch!r} never appeared"


def test_is_valid_qr_token_rejects_bad_input():
    assert not is_valid_qr_token("")
    assert not is_valid_qr_token("short")
    assert not is_valid_qr_token("abcdefghij")  # contains i
    assert not is_valid_qr_token("ABCDEFGHJK")  # uppercase
    assert not is_valid_qr_token("0123456789a")  # too long
    good = generate_qr_token()
    assert is_valid_qr_token(good)
