from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "change-me-in-production-use-long-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://truegauge:truegauge@localhost:5432/truegauge"
    secret_key: str = DEFAULT_SECRET_KEY
    # Separate key for Fernet (Odoo/SMTP secrets). Falls back to secret_key if unset.
    encryption_key: str = ""
    environment: str = Field(default="development", description="development | production | test")
    debug: bool = False
    cors_origins: str = (
        "http://localhost:5173,http://localhost:3000,http://localhost:8080,http://localhost:8081,"
        "http://127.0.0.1:5173,http://127.0.0.1:8080,http://127.0.0.1:8081"
    )
    odoo_model: str = "maintenance.equipment"
    # Public frontend URL used in outbound email CTA buttons (demo default).
    app_public_url: str = "http://localhost:8080"
    # Optional shared secret for POST /api/internal/reminder-tick (ops / manual run)
    reminder_tick_secret: str = ""
    # Auth / session
    access_token_ttl_seconds: int = 60 * 60  # 1 hour
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 14  # 14 days
    handoff_code_ttl_seconds: int = 60
    login_rate_limit_per_minute: int = 5
    # Shared 6-digit passcode for Master Admin staff login (required in production)
    master_admin_passcode: str = ""
    # TrueGage platform SMTP (onboarding emails to new company admins)
    system_smtp_host: str = ""
    system_smtp_port: int = 587
    system_smtp_username: str = ""
    system_smtp_password: str = ""
    system_smtp_from_email: str = ""
    system_smtp_from_name: str = "TrueGage"
    system_smtp_use_tls: bool = True
    # Cloudflare R2 (S3-compatible) — private certificate storage
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    r2_endpoint_url: str = ""
    r2_region: str = "auto"
    # Certificate constraints
    certificate_max_bytes: int = 2 * 1024 * 1024  # 2 MB per file
    certificate_tenant_quota_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB per tenant
    certificate_view_url_ttl_seconds: int = 60

    @model_validator(mode="after")
    def _reject_insecure_secret_in_production(self) -> "Settings":
        env = (self.environment or "development").strip().lower()
        if env in ("production", "prod"):
            if not self.secret_key or self.secret_key == DEFAULT_SECRET_KEY:
                raise ValueError(
                    "SECRET_KEY must be set to a long random value in production "
                    "(do not use the default)."
                )
            if len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be at least 32 characters in production.")
            code = (self.master_admin_passcode or "").strip()
            if not code.isdigit() or len(code) != 6:
                raise ValueError(
                    "MASTER_ADMIN_PASSCODE must be exactly 6 digits in production."
                )
            app_url = (self.app_public_url or "").strip().lower()
            if not app_url or "localhost" in app_url or "127.0.0.1" in app_url:
                raise ValueError(
                    "APP_PUBLIC_URL must be a public https URL in production "
                    "(e.g. https://app.thetruegage.com), not localhost."
                )
            origins = [o.strip().lower() for o in self.cors_origins.split(",") if o.strip()]
            if not origins:
                raise ValueError("CORS_ORIGINS must be set in production.")
            if any("localhost" in o or "127.0.0.1" in o for o in origins):
                raise ValueError(
                    "CORS_ORIGINS must not include localhost in production. "
                    "Use https://app.thetruegage.com,https://admin.thetruegage.com"
                )
            required = {
                "https://app.thetruegage.com",
                "https://admin.thetruegage.com",
            }
            missing = sorted(required - set(origins))
            if missing:
                raise ValueError(
                    "CORS_ORIGINS must include "
                    + ", ".join(missing)
                    + " in production."
                )
        return self

    @property
    def is_production(self) -> bool:
        return (self.environment or "").strip().lower() in ("production", "prod")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def workspace_equipment_url(self, slug: str, *, status: str | None = "overdue") -> str:
        """Customer app CTA: /workspace/{slug}/equipment[?status=]."""
        base = self.app_public_url.rstrip("/")
        cleaned = (slug or "").strip().strip("/")
        path = f"/workspace/{cleaned}/equipment" if cleaned else "/equipment"
        if status:
            return f"{base}{path}?status={status}"
        return f"{base}{path}"

    @property
    def overdue_equipment_url(self) -> str:
        """Fallback CTA without tenant slug (prefer workspace_equipment_url)."""
        return self.workspace_equipment_url("", status="overdue")

    @property
    def fernet_secret(self) -> str:
        return (self.encryption_key or "").strip() or self.secret_key

    @property
    def system_smtp_ready(self) -> bool:
        return bool(
            (self.system_smtp_host or "").strip()
            and (self.system_smtp_from_email or "").strip()
            and (self.system_smtp_password or "").strip()
        )

    @property
    def r2_ready(self) -> bool:
        endpoint = (self.r2_endpoint_url or "").strip()
        if not endpoint and (self.r2_account_id or "").strip():
            endpoint = f"https://{self.r2_account_id.strip()}.r2.cloudflarestorage.com"
        return bool(
            endpoint
            and (self.r2_access_key_id or "").strip()
            and (self.r2_secret_access_key or "").strip()
            and (self.r2_bucket or "").strip()
        )

    @property
    def r2_endpoint(self) -> str:
        explicit = (self.r2_endpoint_url or "").strip()
        if explicit:
            return explicit.rstrip("/")
        account = (self.r2_account_id or "").strip()
        if account:
            return f"https://{account}.r2.cloudflarestorage.com"
        return ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
