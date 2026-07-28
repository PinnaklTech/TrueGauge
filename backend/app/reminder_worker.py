"""Dedicated reminder worker process (separate from uvicorn)."""

from __future__ import annotations

import logging
import time

from app.database import SessionLocal
from app.services.reminder_engine import run_reminder_tick

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [reminder-worker] %(message)s",
)
logger = logging.getLogger("truegauge.reminder_worker")

TICK_SECONDS = 60


def main() -> None:
    logger.info("starting reminder worker (tick=%ss)", TICK_SECONDS)
    while True:
        db = SessionLocal()
        try:
            result = run_reminder_tick(db)
            processed = int(result.get("jobs_processed") or 0)
            if processed:
                logger.info("tick processed %s job(s)", processed)
        except Exception:  # noqa: BLE001
            logger.exception("reminder tick failed")
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
        finally:
            db.close()
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    main()
