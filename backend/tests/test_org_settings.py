"""Org regional settings: resolution, formatting, scheduler selection, migration map."""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.org_settings import (
    DATE_FORMATS,
    TIME_FORMATS,
    days_until_due,
    format_date,
    format_datetime,
    format_time,
    is_valid_iana,
    is_weekend,
    local_hour,
    local_today,
    normalize_timezone,
    resolve_effective_settings,
)

# Mirrors alembic 022_org_regional_settings.LEGACY_TZ
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


def _org(**kwargs):
    base = dict(
        timezone="UTC",
        date_format="DD MMM YYYY",
        time_format="12h",
        week_start="monday",
        reminder_hour_local=9,
        reminder_skip_weekends=False,
        allow_user_display_override=False,
        allow_user_channel_toggle=True,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def _user(**kwargs):
    base = dict(
        timezone_override=None,
        date_format_override=None,
        time_format_override=None,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


class TestResolveEffectiveSettings:
    def test_org_defaults_when_override_off(self):
        org = _org(
            timezone="Asia/Kolkata",
            date_format="DD/MM/YYYY",
            time_format="24h",
            allow_user_display_override=False,
        )
        user = _user(
            timezone_override="America/Chicago",
            date_format_override="MM/DD/YYYY",
            time_format_override="12h",
        )
        eff = resolve_effective_settings(org, user)
        assert eff.timezone == "Asia/Kolkata"
        assert eff.date_format == "DD/MM/YYYY"
        assert eff.time_format == "24h"
        assert eff.timezone_source == "org"

    def test_user_overrides_when_allowed(self):
        org = _org(allow_user_display_override=True, timezone="UTC")
        user = _user(
            timezone_override="America/Chicago",
            date_format_override="MM/DD/YYYY",
            time_format_override="12h",
        )
        eff = resolve_effective_settings(org, user)
        assert eff.timezone == "America/Chicago"
        assert eff.date_format == "MM/DD/YYYY"
        assert eff.time_format == "12h"
        assert eff.timezone_source == "user"

    def test_partial_override(self):
        org = _org(
            allow_user_display_override=True,
            timezone="UTC",
            date_format="YYYY-MM-DD",
            time_format="24h",
        )
        user = _user(timezone_override="Asia/Kolkata")
        eff = resolve_effective_settings(org, user)
        assert eff.timezone == "Asia/Kolkata"
        assert eff.date_format == "YYYY-MM-DD"
        assert eff.time_format == "24h"
        assert eff.date_format_source == "org"

    def test_invalid_user_override_ignored(self):
        org = _org(allow_user_display_override=True, timezone="UTC")
        user = _user(timezone_override="Not/AZone", date_format_override="bogus")
        eff = resolve_effective_settings(org, user)
        assert eff.timezone == "UTC"
        assert eff.date_format == "DD MMM YYYY"


class TestFormatting:
    def test_all_date_formats(self):
        d = date(2026, 10, 21)
        assert format_date(d, "DD/MM/YYYY") == "21/10/2026"
        assert format_date(d, "MM/DD/YYYY") == "10/21/2026"
        assert format_date(d, "YYYY-MM-DD") == "2026-10-21"
        assert format_date(d, "DD MMM YYYY") == "21 Oct 2026"

    def test_time_12h_24h_kolkata(self):
        dt = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
        assert format_time(dt, "24h", "Asia/Kolkata") == "14:30"
        assert format_time(dt, "12h", "Asia/Kolkata") == "2:30 PM"

    def test_midnight_and_noon(self):
        midnight = datetime(2026, 3, 8, 0, 0, tzinfo=timezone.utc)
        noon = datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)
        assert format_time(midnight, "24h", "UTC") == "00:00"
        assert format_time(noon, "12h", "UTC") == "12:00 PM"

    def test_datetime_combo(self):
        dt = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
        out = format_datetime(
            dt, date_format="DD/MM/YYYY", time_format="24h", tz_name="Asia/Kolkata"
        )
        assert out == "21/10/2026, 14:30"

    def test_enums_complete(self):
        assert "DD MMM YYYY" in DATE_FORMATS
        assert "12h" in TIME_FORMATS


class TestDaysUntilDue:
    def test_near_midnight_kolkata(self):
        now = datetime(2026, 10, 20, 20, 30, tzinfo=timezone.utc)
        today = local_today("Asia/Kolkata", now_utc=now)
        assert today == date(2026, 10, 21)
        assert days_until_due(date(2026, 10, 21), today) == 0
        assert days_until_due(date(2026, 10, 22), today) == 1
        assert days_until_due(date(2026, 10, 20), today) == -1

    def test_chicago_evening(self):
        now = datetime(2026, 10, 21, 4, 0, tzinfo=timezone.utc)
        today = local_today("America/Chicago", now_utc=now)
        assert today == date(2026, 10, 20)


class TestSchedulerHourSelection:
    def test_utc_hour(self):
        now = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
        assert local_hour("UTC", now_utc=now) == 9

    def test_kolkata_send_hour(self):
        now = datetime(2026, 10, 21, 3, 30, tzinfo=timezone.utc)
        assert local_hour("Asia/Kolkata", now_utc=now) == 9

    def test_chicago_cdt(self):
        # CDT = UTC-5 in October
        now = datetime(2026, 10, 21, 14, 0, tzinfo=timezone.utc)
        assert local_hour("America/Chicago", now_utc=now) == 9

    def test_auckland_nzdt(self):
        # NZDT ≈ UTC+13 in October
        now = datetime(2026, 10, 21, 20, 0, tzinfo=timezone.utc)
        assert local_hour("Pacific/Auckland", now_utc=now) == 9

    def test_weekend_skip(self):
        assert is_weekend(date(2026, 10, 24))
        assert is_weekend(date(2026, 10, 25))
        assert not is_weekend(date(2026, 10, 26))


class TestIanaAndLegacy:
    def test_valid_iana(self):
        assert is_valid_iana("Asia/Kolkata")
        assert is_valid_iana("UTC")
        assert not is_valid_iana("IST")
        assert not is_valid_iana("")

    def test_legacy_label_map(self):
        for legacy, iana in LEGACY_TZ.items():
            assert is_valid_iana(iana), iana
            assert normalize_timezone(iana) == iana
            assert legacy  # key present
