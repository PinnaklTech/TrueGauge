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
    # Auth / session
    access_token_ttl_seconds: int = 60 * 60  # 1 hour
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 14  # 14 days
    handoff_code_ttl_seconds: int = 60
    login_rate_limit_per_minute: int = 5

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
        return self

    @property
    def is_production(self) -> bool:
        return (self.environment or "").strip().lower() in ("production", "prod")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def overdue_equipment_url(self) -> str:
        base = self.app_public_url.rstrip("/")
        return f"{base}/equipment?status=overdue"

    @property
    def fernet_secret(self) -> str:
        return (self.encryption_key or "").strip() or self.secret_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
