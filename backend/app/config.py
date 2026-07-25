from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://truegauge:truegauge@localhost:5432/truegauge"
    secret_key: str = "change-me-in-production-use-long-random-string"
    cors_origins: str = (
        "http://localhost:5173,http://localhost:3000,http://localhost:8080,http://localhost:8081,"
        "http://127.0.0.1:5173,http://127.0.0.1:8080,http://127.0.0.1:8081"
    )
    odoo_model: str = "maintenance.equipment"
    # Public frontend URL used in outbound email CTA buttons (demo default).
    app_public_url: str = "http://localhost:8080"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def overdue_equipment_url(self) -> str:
        base = self.app_public_url.rstrip("/")
        return f"{base}/equipment?status=overdue"


@lru_cache
def get_settings() -> Settings:
    return Settings()
