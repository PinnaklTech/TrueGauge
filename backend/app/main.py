from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.accounts import router as accounts_router
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="True Gauge API",
    description="Calibration notification platform — Odoo integration & equipment cache",
    version="0.1.0",
)

# Allow configured origins plus any localhost / 127.0.0.1 port (Vite often uses 8080/5173).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(router, prefix="/api")
app.include_router(accounts_router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "True Gauge API", "docs": "/docs"}
