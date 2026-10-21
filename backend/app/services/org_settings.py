"""Org regional settings: resolution, validation, and formatting helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from app.models import AppSettings, User

DateFormat = Literal["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY"]
TimeFormat = Literal["12h", "24h"]
WeekStart = Literal["sunday", "monday"]

DATE_FORMATS: tuple[str, ...] = ("DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY")
TIME_FORMATS: tuple[str, ...] = ("12h", "24h")
WEEK_STARTS: tuple[str, ...] = ("sunday", "monday")

IANA_ZONES = frozenset(available_timezones())


def is_valid_iana(name: str) -> bool:
    key = (name or "").strip()
    if not key:
        return False
    if key in IANA_ZONES:
        return True
    try:
        ZoneInfo(key)
        return True
    except ZoneInfoNotFoundError:
        return False


def normalize_timezone(name: str) -> str:
    key = (name or "UTC").strip() or "UTC"
    return key if is_valid_iana(key) else "UTC"


@dataclass(frozen=True)
class EffectiveSettings:
    timezone: str
    date_format: str
    time_format: str
    week_start: str
    reminder_send_hour: int
    reminder_skip_weekends: bool
    allow_user_display_override: bool
    allow_user_channel_toggle: bool
    timezone_source: Literal["org", "user"]
    date_format_source: Literal["org", "user"]
    time_format_source: Literal["org", "user"]


def org_defaults_from_row(row: AppSettings) -> dict:
    return {
        "timezone": normalize_timezone(row.timezone or "UTC"),
        "date_format": (row.date_format or "DD MMM YYYY")
        if (row.date_format or "") in DATE_FORMATS
        else "DD MMM YYYY",
        "time_format": (row.time_format or "12h")
        if (row.time_format or "") in TIME_FORMATS
        else "12h",
        "week_start": (row.week_start or "monday")
        if (row.week_start or "") in WEEK_STARTS
        else "monday",
        "reminder_send_hour": max(0, min(23, int(getattr(row, "reminder_hour_local", 9) or 9))),
        "reminder_skip_weekends": bool(getattr(row, "reminder_skip_weekends", False)),
        "allow_user_display_override": bool(getattr(row, "allow_user_display_override", False)),
        "allow_user_channel_toggle": bool(getattr(row, "allow_user_channel_toggle", True)),
    }


def resolve_effective_settings(
    org: AppSettings,
    user: Optional[User] = None,
) -> EffectiveSettings:
    base = org_defaults_from_row(org)
    allow_display = base["allow_user_display_override"]

    tz = base["timezone"]
    tz_src: Literal["org", "user"] = "org"
    df = base["date_format"]
    df_src: Literal["org", "user"] = "org"
    tf = base["time_format"]
    tf_src: Literal["org", "user"] = "org"

    if allow_display and user is not None:
        u_tz = (getattr(user, "timezone_override", None) or "").strip()
        if u_tz and is_valid_iana(u_tz):
            tz = u_tz
            tz_src = "user"
        u_df = (getattr(user, "date_format_override", None) or "").strip()
        if u_df in DATE_FORMATS:
            df = u_df
            df_src = "user"
        u_tf = (getattr(user, "time_format_override", None) or "").strip()
        if u_tf in TIME_FORMATS:
            tf = u_tf
            tf_src = "user"

    return EffectiveSettings(
        timezone=tz,
        date_format=df,
        time_format=tf,
        week_start=base["week_start"],
        reminder_send_hour=base["reminder_send_hour"],
        reminder_skip_weekends=base["reminder_skip_weekends"],
        allow_user_display_override=allow_display,
        allow_user_channel_toggle=base["allow_user_channel_toggle"],
        timezone_source=tz_src,
        date_format_source=df_src,
        time_format_source=tf_src,
    )


def effective_to_dict(eff: EffectiveSettings) -> dict:
    return {
        "timezone": eff.timezone,
        "date_format": eff.date_format,
        "time_format": eff.time_format,
        "week_start": eff.week_start,
        "reminder_send_hour": eff.reminder_send_hour,
        "reminder_skip_weekends": eff.reminder_skip_weekends,
        "allow_user_display_override": eff.allow_user_display_override,
        "allow_user_channel_toggle": eff.allow_user_channel_toggle,
        "sources": {
            "timezone": eff.timezone_source,
            "date_format": eff.date_format_source,
            "time_format": eff.time_format_source,
        },
    }


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(normalize_timezone(name))
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def format_date(value: date | datetime | None, date_format: str) -> str:
    if value is None:
        return ""
    d = value.date() if isinstance(value, datetime) else value
    if date_format == "DD/MM/YYYY":
        return d.strftime("%d/%m/%Y")
    if date_format == "MM/DD/YYYY":
        return d.strftime("%m/%d/%Y")
    if date_format == "YYYY-MM-DD":
        return d.isoformat()
    # DD MMM YYYY
    return d.strftime("%d %b %Y")


def format_time(value: datetime | time | None, time_format: str, tz_name: str = "UTC") -> str:
    if value is None:
        return ""
    if isinstance(value, time):
        hh, mm = value.hour, value.minute
    else:
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(_zone(tz_name))
        hh, mm = local.hour, local.minute
    if time_format == "24h":
        return f"{hh:02d}:{mm:02d}"
    ampm = "AM" if hh < 12 else "PM"
    h12 = hh % 12 or 12
    return f"{h12}:{mm:02d} {ampm}"


def format_datetime(
    value: datetime | None,
    *,
    date_format: str,
    time_format: str,
    tz_name: str,
) -> str:
    if value is None:
        return ""
    dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    local = dt.astimezone(_zone(tz_name))
    return f"{format_date(local.date(), date_format)}, {format_time(local, time_format, tz_name)}"


def local_today(tz_name: str, *, now_utc: Optional[datetime] = None) -> date:
    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(_zone(tz_name)).date()


def local_hour(tz_name: str, *, now_utc: Optional[datetime] = None) -> int:
    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(_zone(tz_name)).hour


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5  # Sat=5 Sun=6


def days_until_due(due: date | None, today: date) -> Optional[int]:
    if due is None:
        return None
    return (due - today).days
