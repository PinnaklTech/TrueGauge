"""Map Odoo maintenance.equipment into app-owned equipment (import + refresh)."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AppSettings, EquipmentCache
from app.services.odoo_client import OdooClient, OdooError

# Defaults used when Settings field mappings are blank (Odoo Studio names)
DEFAULT_CALIBRATION_DATE_FIELD = "x_studio_equipment_last_calibration_date"
DEFAULT_CALIBRATION_DUE_FIELD = "x_studio_next_calibration_due_date"
DEFAULT_RESPONSIBLE_EMAIL_FIELD = "x_responsible_email"

CALIBRATION_DATE_CANDIDATES = (
    DEFAULT_CALIBRATION_DATE_FIELD,
    "x_calibration_date",
    "x_studio_calibration_date",
    "last_calibration_date",
    "calibration_date",
)
CALIBRATION_DUE_CANDIDATES = (
    DEFAULT_CALIBRATION_DUE_FIELD,
    "x_calibration_due_date",
    "x_studio_calibration_due_date",
    "next_calibration_date",
    "calibration_due_date",
    "next_action_date",
)
EMAIL_CANDIDATES = (
    DEFAULT_RESPONSIBLE_EMAIL_FIELD,
    "x_studio_responsible_email",
    "work_email",
)
FREQUENCY_CANDIDATES = (
    "x_studio_calibration_frequency",
    "x_calibration_frequency",
    "calibration_frequency",
)

# Fields we refresh from Odoo on existing rows (do not overwrite local-only edits like notes)
ODOO_REFRESH_KEYS = (
    "name",
    "tag",
    "category",
    "manufacturer",
    "model",
    "serial",
    "location",
    "status",
    "last_calibration",
    "next_calibration",
    "frequency_days",
    "owner",
    "responsible_email",
    "raw_payload",
    "synced_at",
)


def _m2o_name(value: Any) -> str:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return str(value[1] or "")
    if value in (False, None):
        return ""
    return str(value)


def _parse_date(value: Any) -> Optional[date]:
    if not value or value is False:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text or text == "False":
        return None
    # Odoo may return datetime strings
    text = text[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _pick_field(record: dict[str, Any], preferred: Optional[str], candidates: tuple[str, ...]) -> Any:
    if preferred and preferred in record and record[preferred] not in (False, None, ""):
        return record[preferred]
    for key in candidates:
        if key in record and record[key] not in (False, None, ""):
            return record[key]
    return None


def compute_status(next_cal: Optional[date], today: Optional[date] = None) -> str:
    today = today or date.today()
    if next_cal is None:
        return "inactive"
    delta = (next_cal - today).days
    if delta < 0:
        return "overdue"
    if delta <= 30:
        return "due-soon"
    return "calibrated"


def refresh_equipment_status(row: EquipmentCache, today: Optional[date] = None) -> bool:
    """Keep calendar statuses current from next_calibration. Preserves failed/inactive."""
    if row.status in ("failed", "inactive"):
        return False
    new_status = compute_status(row.next_calibration, today)
    if row.status != new_status:
        row.status = new_status
        return True
    return False


def refresh_equipment_statuses(
    db: Session,
    rows: list[EquipmentCache] | None = None,
    today: Optional[date] = None,
    *,
    commit: bool = True,
) -> int:
    """Recompute and persist stale calendar statuses. Returns number of rows updated."""
    as_of = today or date.today()
    targets = rows if rows is not None else db.query(EquipmentCache).all()
    updated = 0
    for row in targets:
        if refresh_equipment_status(row, as_of):
            updated += 1
    if updated:
        if commit:
            db.commit()
        else:
            db.flush()
    return updated


def map_odoo_record(
    record: dict[str, Any],
    *,
    field_calibration_date: Optional[str] = None,
    field_calibration_due: Optional[str] = None,
    field_responsible_email: Optional[str] = None,
) -> dict[str, Any]:
    serial = str(record.get("serial_no") or record.get("serial") or "")
    if serial in ("False", "None"):
        serial = ""
    name = str(record.get("name") or "")
    odoo_id = int(record["id"])
    tag = serial or f"EQ-{odoo_id}"

    cal_field = field_calibration_date or DEFAULT_CALIBRATION_DATE_FIELD
    due_field = field_calibration_due or DEFAULT_CALIBRATION_DUE_FIELD
    email_field = field_responsible_email or DEFAULT_RESPONSIBLE_EMAIL_FIELD

    last_cal = _parse_date(_pick_field(record, cal_field, CALIBRATION_DATE_CANDIDATES))
    next_cal = _parse_date(_pick_field(record, due_field, CALIBRATION_DUE_CANDIDATES))
    owner = _m2o_name(
        record.get("technician_user_id")
        or record.get("owner_user_id")
        or record.get("employee_id")
    )
    email_val = _pick_field(record, email_field, EMAIL_CANDIDATES)
    email = None if email_val in (False, None, "") else str(email_val)

    frequency = 365
    freq_raw = _pick_field(record, None, FREQUENCY_CANDIDATES)
    if freq_raw not in (False, None, ""):
        try:
            # Accept "365", "365 days", etc.
            digits = "".join(ch for ch in str(freq_raw) if ch.isdigit())
            if digits:
                frequency = max(1, int(digits))
        except ValueError:
            pass
    if last_cal and next_cal:
        frequency = max(1, (next_cal - last_cal).days)

    location_raw = record.get("location")
    location = _m2o_name(location_raw) if isinstance(location_raw, (list, tuple)) else str(location_raw or "")
    if location == "False":
        location = ""

    return {
        "public_id": f"eq-{uuid4().hex[:12]}",
        "odoo_id": odoo_id,
        "source": "odoo",
        "tag": tag,
        "name": name,
        "category": _m2o_name(record.get("category_id")),
        "manufacturer": _m2o_name(record.get("partner_id")),
        "model": str(record.get("model") or "") if record.get("model") not in (False, None) else "",
        "serial": serial,
        "department": "",
        "location": location,
        "status": compute_status(next_cal),
        "last_calibration": last_cal,
        "next_calibration": next_cal,
        "frequency_days": frequency,
        "owner": owner,
        "responsible_email": email,
        "raw_payload": json.dumps(record, default=str),
        "synced_at": datetime.now(timezone.utc),
    }


STANDARD_FIELDS = [
    "id",
    "name",
    "category_id",
    "serial_no",
    "partner_id",
    "model",
    "location",
    "technician_user_id",
    "owner_user_id",
    "next_action_date",
]


def resolve_fields(
    available: dict[str, Any],
    *,
    field_calibration_date: Optional[str],
    field_calibration_due: Optional[str],
    field_responsible_email: Optional[str],
) -> list[str]:
    """Build search_read field list.

    Always includes configured/default calibration field names so custom Studio
    fields are requested even when fields_get is incomplete.
    """
    cal = (field_calibration_date or DEFAULT_CALIBRATION_DATE_FIELD).strip()
    due = (field_calibration_due or DEFAULT_CALIBRATION_DUE_FIELD).strip()
    email = (field_responsible_email or DEFAULT_RESPONSIBLE_EMAIL_FIELD).strip()

    fields = [f for f in STANDARD_FIELDS if not available or f in available]
    extras = [
        cal,
        due,
        email,
        *CALIBRATION_DATE_CANDIDATES,
        *CALIBRATION_DUE_CANDIDATES,
        *EMAIL_CANDIDATES,
        *FREQUENCY_CANDIDATES,
        "employee_id",
        "serial",
    ]
    for f in extras:
        if not f:
            continue
        # Prefer known-available fields; still force preferred Studio fields
        if f in (cal, due, email) or not available or f in available:
            if f not in fields:
                fields.append(f)
    if "id" not in fields:
        fields.insert(0, "id")
    if "name" not in fields:
        fields.append("name")
    return fields


_INVALID_FIELD_RE = re.compile(r"Invalid field[s]? ['\"]?([a-zA-Z0-9_.]+)['\"]?", re.I)


def _search_read_with_field_fallback(
    client: OdooClient,
    model: str,
    fields: list[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Request fields; if Odoo rejects unknown ones, drop them and retry."""
    remaining = list(fields)
    last_error: Optional[OdooError] = None
    for _ in range(8):
        try:
            return client.search_read(model, domain=[], fields=remaining, order="id asc"), remaining
        except OdooError as exc:
            last_error = exc
            msg = str(exc)
            match = _INVALID_FIELD_RE.search(msg)
            if not match:
                # Some Odoo versions say "Invalid field equipment.x_foo"
                drop = None
                for f in remaining:
                    if f in msg and f not in ("id", "name"):
                        drop = f
                        break
                if not drop:
                    raise
            else:
                drop = match.group(1)
                if "." in drop:
                    drop = drop.split(".")[-1]
            if drop in remaining and drop not in ("id", "name"):
                remaining.remove(drop)
                continue
            raise
    if last_error:
        raise last_error
    raise OdooError("Could not read equipment fields from Odoo")


def sync_equipment_from_odoo(db: Session, settings_row: AppSettings) -> dict[str, Any]:
    """One-way sync: import new Odoo equipment and refresh calibration fields on existing Odoo rows."""
    if not (
        settings_row.odoo_url
        and settings_row.odoo_database
        and settings_row.odoo_username
        and settings_row.odoo_api_key_encrypted
    ):
        raise OdooError("Odoo credentials are not configured")

    from app.security import decrypt_secret

    client = OdooClient(
        url=settings_row.odoo_url,
        database=settings_row.odoo_database,
        username=settings_row.odoo_username,
        api_key=decrypt_secret(settings_row.odoo_api_key_encrypted),
    )
    client.authenticate()

    model = get_settings().odoo_model
    try:
        available = client.fields_get(model)
    except OdooError:
        available = {}

    fields = resolve_fields(
        available,
        field_calibration_date=settings_row.field_calibration_date,
        field_calibration_due=settings_row.field_calibration_due,
        field_responsible_email=settings_row.field_responsible_email,
    )

    records, used_fields = _search_read_with_field_fallback(client, model, fields)
    imported = 0
    updated = 0
    now = datetime.now(timezone.utc)

    for record in records:
        mapped = map_odoo_record(
            record,
            field_calibration_date=settings_row.field_calibration_date,
            field_calibration_due=settings_row.field_calibration_due,
            field_responsible_email=settings_row.field_responsible_email,
        )
        existing = (
            db.query(EquipmentCache)
            .filter(
                EquipmentCache.tenant_id == settings_row.tenant_id,
                EquipmentCache.odoo_id == mapped["odoo_id"],
            )
            .one_or_none()
        )
        if existing:
            for key in ODOO_REFRESH_KEYS:
                setattr(existing, key, mapped[key])
            updated += 1
            continue
        db.add(EquipmentCache(tenant_id=settings_row.tenant_id, **mapped))
        imported += 1

    settings_row.odoo_connected = True
    settings_row.odoo_last_sync_at = now
    settings_row.odoo_last_error = None
    db.commit()

    total = len(records)
    message = (
        f"Imported {imported} new, refreshed {updated} from Odoo "
        f"({total} in Odoo). Fields used: {', '.join(used_fields)}"
    )
    return {
        "imported": imported,
        "updated": updated,
        "skipped": 0,
        "total_in_odoo": total,
        "message": message,
        "fields_used": used_fields,
    }
