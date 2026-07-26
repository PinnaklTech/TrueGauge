from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api import router
from app.accounts import router as accounts_router
from app.config import get_settings

settings = get_settings()

_docs = "/docs" if (settings.debug or not settings.is_production) else None
_redoc = "/redoc" if (settings.debug or not settings.is_production) else None
_openapi = "/openapi.json" if (settings.debug or not settings.is_production) else None

app = FastAPI(
    title="TrueGage API",
    description="Calibration notification platform — Odoo integration & equipment cache",
    version="0.1.0",
    docs_url=_docs,
    redoc_url=_redoc,
    openapi_url=_openapi,
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)

cors_kwargs: dict = {
    "allow_origins": settings.cors_origin_list,
    "allow_credentials": True,
    "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allow_headers": ["Authorization", "Content-Type", "Accept"],
    "expose_headers": ["X-Request-Id"],
}
# Local Vite ports only outside production
if not settings.is_production:
    cors_kwargs["allow_origin_regex"] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(CORSMiddleware, **cors_kwargs)

app.include_router(router, prefix="/api")
app.include_router(accounts_router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    payload = {"name": "TrueGage API", "status": "ok"}
    if _docs:
        payload["docs"] = "/docs"
    return payload
