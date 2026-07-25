# True Gauge API

FastAPI + PostgreSQL backend for Odoo equipment sync (see root `Odoo_Calibration_Notification_Platform_PRD.md`).

## Run with Docker

From the repository root:

```bash
cp .env.example .env
docker compose up --build
```

- API: http://localhost:8000  
- Docs: http://localhost:8000/docs  
- Postgres: `localhost:5432` (`truegauge` / `truegauge` / db `truegauge`)

Migrations run automatically on API container start (`alembic upgrade head`).

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | API + DB health |
| GET | `/api/odoo/status` | Connection / last sync status |
| PUT | `/api/odoo/credentials` | Save Odoo URL, DB, user, API key (encrypted) |
| POST | `/api/odoo/test` | Authenticate against Odoo |
| POST | `/api/odoo/sync` | Pull `maintenance.equipment` into `equipment_cache` |
| GET | `/api/equipment` | List cached equipment |
| GET | `/api/equipment/{id}` | Equipment detail (`eq-{odoo_id}`) |

API keys are encrypted at rest with Fernet derived from `SECRET_KEY`. Never commit real secrets.
