"""Unit tests for equipment CSV/XLSX bulk import helpers (no DB)."""

from __future__ import annotations

from app.services.equipment_bulk import (
    EXPORT_COLUMNS,
    build_template_csv,
    normalize_headers,
    parse_spreadsheet,
    validate_and_parse_rows,
)


def test_normalize_headers_aliases():
    mapping = normalize_headers(["Tag ID", "Equipment Name", "Serial No", "Next Due"])
    assert mapping["tag"] == 0
    assert mapping["name"] == 1
    assert mapping["serial"] == 2
    assert mapping["next_calibration"] == 3


def test_template_has_expected_columns():
    raw = build_template_csv().decode("utf-8-sig")
    header = raw.splitlines()[0]
    cols = header.split(",")
    assert cols == EXPORT_COLUMNS
    assert "EQ-001" in raw


def test_happy_path_csv_parse():
    csv = (
        "tag,name,serial,status,last_calibration,next_calibration\n"
        "EQ-1,Caliper,SN1,calibrated,2025-01-01,2026-01-01\n"
        "EQ-2,Wrench,SN2,due-soon,2025-06-01,2025-12-01\n"
    ).encode("utf-8")
    rows = parse_spreadsheet("gauges.csv", csv)
    parsed, errors = validate_and_parse_rows(rows, existing_tags_lower=set())
    assert errors == []
    assert len(parsed) == 2
    assert parsed[0].tag == "EQ-1"
    assert parsed[0].frequency_days == 365
    assert parsed[1].status == "due-soon"


def test_missing_name_fails_row():
    csv = b"tag,name\nEQ-1,\n"
    rows = parse_spreadsheet("x.csv", csv)
    parsed, errors = validate_and_parse_rows(rows, existing_tags_lower=set())
    assert parsed == []
    assert any(e.field == "name" for e in errors)


def test_duplicate_tag_in_file_skipped():
    csv = b"tag,name\nEQ-1,One\nEQ-1,Two\n"
    rows = parse_spreadsheet("x.csv", csv)
    parsed, errors = validate_and_parse_rows(rows, existing_tags_lower=set())
    assert len(parsed) == 1
    assert any("Duplicate tag in file" in e.message for e in errors)


def test_existing_tag_in_db_skipped():
    csv = b"tag,name\nEQ-1,One\nEQ-2,Two\n"
    rows = parse_spreadsheet("x.csv", csv)
    parsed, errors = validate_and_parse_rows(
        rows, existing_tags_lower={"eq-1"}
    )
    assert len(parsed) == 1
    assert parsed[0].tag == "EQ-2"
    assert any("already exists" in e.message.lower() for e in errors)


def test_bad_date_and_status():
    csv = b"tag,name,status,last_calibration\nEQ-1,A,nope,not-a-date\n"
    rows = parse_spreadsheet("x.csv", csv)
    parsed, errors = validate_and_parse_rows(rows, existing_tags_lower=set())
    assert parsed == []
    assert len(errors) >= 1


def test_derive_tag_from_serial_or_name():
    csv = b"name,serial\nOnly Name,\nFrom Serial,SN-99\n"
    rows = parse_spreadsheet("x.csv", csv)
    parsed, errors = validate_and_parse_rows(rows, existing_tags_lower=set())
    assert errors == []
    assert parsed[0].tag == "Only Name"[:32] or parsed[0].tag == "Only Name"
    assert parsed[1].tag == "SN-99"


def test_next_before_last_rejected():
    csv = b"tag,name,last_calibration,next_calibration\nEQ-1,A,2026-01-01,2025-01-01\n"
    rows = parse_spreadsheet("x.csv", csv)
    parsed, errors = validate_and_parse_rows(rows, existing_tags_lower=set())
    assert parsed == []
    assert any(e.field == "next_calibration" for e in errors)
