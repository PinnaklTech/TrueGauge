"""API gate logic for org settings / preferences (pure validation helpers)."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.org_settings import (
    DATE_FORMATS,
    TIME_FORMATS,
    WEEK_STARTS,
    is_valid_iana,
    resolve_effective_settings,
)


def test_patch_field_validators():
    assert "DD/MM/YYYY" in DATE_FORMATS
    assert "24h" in TIME_FORMATS
    assert "monday" in WEEK_STARTS
    assert is_valid_iana("Pacific/Auckland")
    assert not is_valid_iana("ET")


def test_channel_gate_semantics():
    """When allow_user_channel_toggle is false, preference API must 403 — exercised via flag."""
    org = SimpleNamespace(
        timezone="UTC",
        date_format="DD MMM YYYY",
        time_format="12h",
        week_start="monday",
        reminder_hour_local=9,
        reminder_skip_weekends=False,
        allow_user_display_override=False,
        allow_user_channel_toggle=False,
    )
    eff = resolve_effective_settings(org, None)
    assert eff.allow_user_channel_toggle is False
    assert eff.allow_user_display_override is False


def test_display_gate_semantics():
    org = SimpleNamespace(
        timezone="Europe/London",
        date_format="DD/MM/YYYY",
        time_format="24h",
        week_start="sunday",
        reminder_hour_local=8,
        reminder_skip_weekends=True,
        allow_user_display_override=True,
        allow_user_channel_toggle=True,
    )
    user = SimpleNamespace(
        timezone_override="UTC",
        date_format_override=None,
        time_format_override="12h",
    )
    eff = resolve_effective_settings(org, user)
    assert eff.timezone == "UTC"
    assert eff.date_format == "DD/MM/YYYY"
    assert eff.time_format == "12h"
    assert eff.reminder_skip_weekends is True
    assert eff.week_start == "sunday"
