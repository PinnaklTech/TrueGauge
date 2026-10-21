"""Generated report history: keep last 3, list, download helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import GeneratedReport, Tenant
from app.services.report_history import (
    KEEP_LAST,
    get_report,
    list_reports,
    prune_old_reports,
    save_generated_report,
)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_save_prunes_to_last_three():
    db = _session()
    tenant = Tenant(slug="acme", name="Acme")
    db.add(tenant)
    db.flush()

    base = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
    # Insert four rows with explicit timestamps, then prune once
    for i in range(4):
        row = GeneratedReport(
            tenant_id=tenant.id,
            report_id=f"TG-RPT-20261021-{i + 1:04d}",
            report_type="compliance",
            filename=f"TG-RPT-20261021-{i + 1:04d}.pdf",
            generated_by_name="Priya Nair",
            generated_by_role="qa",
            row_count=10 + i,
            content=b"%PDF-fake-" + bytes([i]),
            meta_json='{"label":"Compliance summary"}',
            created_at=base + timedelta(minutes=i),
        )
        db.add(row)
    db.flush()
    deleted = prune_old_reports(db, tenant_id=tenant.id, keep=KEEP_LAST)
    db.commit()
    assert deleted == 1

    remaining = (
        db.query(GeneratedReport)
        .filter(GeneratedReport.tenant_id == tenant.id)
        .order_by(GeneratedReport.created_at.desc())
        .all()
    )
    assert len(remaining) == KEEP_LAST
    assert [r.report_id for r in remaining] == [
        "TG-RPT-20261021-0004",
        "TG-RPT-20261021-0003",
        "TG-RPT-20261021-0002",
    ]

    listed = list_reports(db, tenant_id=tenant.id)
    assert len(listed) == 3
    assert listed[0].report_id == "TG-RPT-20261021-0004"

    got = get_report(db, tenant_id=tenant.id, report_pk=listed[0].id)
    assert got is not None
    assert got.content.startswith(b"%PDF-fake-")
    assert got.filename.endswith(".pdf")

    assert get_report(db, tenant_id=tenant.id, report_pk=99999) is None
    assert prune_old_reports(db, tenant_id=999, keep=3) == 0


def test_save_generated_report_helper_keeps_three():
    db = _session()
    tenant = Tenant(slug="beta", name="Beta")
    db.add(tenant)
    db.flush()

    for i in range(4):
        save_generated_report(
            db,
            tenant_id=tenant.id,
            report_id=f"TG-RPT-20261022-{i + 1:04d}",
            report_type="compliance",
            filename=f"TG-RPT-20261022-{i + 1:04d}.pdf",
            content=b"%PDF-" + str(i).encode(),
            row_count=i,
            generated_by_user_id=None,
            generated_by_name="Admin",
            generated_by_role="admin",
        )
    db.commit()
    assert (
        db.query(GeneratedReport).filter(GeneratedReport.tenant_id == tenant.id).count()
        == KEEP_LAST
    )
