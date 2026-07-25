"""Odoo Online client via XML-RPC (API key used as password)."""

from __future__ import annotations

from typing import Any, Optional
from xmlrpc.client import Fault, ProtocolError, ServerProxy


class OdooError(Exception):
    def __init__(self, message: str, *, detail: Any = None):
        super().__init__(message)
        self.detail = detail


class OdooClient:
    def __init__(self, url: str, database: str, username: str, api_key: str, timeout: float = 60.0):
        self.base_url = url.rstrip("/")
        self.database = database
        self.username = username
        self.api_key = api_key
        self.timeout = timeout
        self._uid: Optional[int] = None
        self._common = ServerProxy(f"{self.base_url}/xmlrpc/2/common", allow_none=True)
        self._models = ServerProxy(f"{self.base_url}/xmlrpc/2/object", allow_none=True)

    def version(self) -> dict[str, Any]:
        try:
            result = self._common.version()
        except (Fault, ProtocolError, OSError) as exc:
            raise OdooError(f"Could not reach Odoo at {self.base_url}: {exc}") from exc
        if not isinstance(result, dict):
            raise OdooError("Unexpected version response from Odoo")
        return result

    def authenticate(self) -> int:
        try:
            # Warm-up: confirms URL is reachable before auth
            self.version()
            result = self._common.authenticate(self.database, self.username, self.api_key, {})
        except OdooError:
            raise
        except Fault as exc:
            raise OdooError(f"Odoo authentication error: {exc.faultString}") from exc
        except (ProtocolError, OSError) as exc:
            raise OdooError(f"Could not reach Odoo at {self.base_url}: {exc}") from exc

        if not result or result is False:
            raise OdooError(
                "Authentication failed — check database name, username, and API key. "
                "For Odoo Online, generate an API key under Preferences → Account Security."
            )
        self._uid = int(result)
        return self._uid

    @property
    def uid(self) -> int:
        if self._uid is None:
            return self.authenticate()
        return self._uid

    def execute_kw(
        self,
        model: str,
        method: str,
        args: list[Any] | None = None,
        kwargs: dict[str, Any] | None = None,
    ) -> Any:
        uid = self.uid
        try:
            return self._models.execute_kw(
                self.database,
                uid,
                self.api_key,
                model,
                method,
                args or [],
                kwargs or {},
            )
        except Fault as exc:
            raise OdooError(exc.faultString or str(exc), detail=exc) from exc
        except (ProtocolError, OSError) as exc:
            raise OdooError(f"Odoo request failed: {exc}") from exc

    def search_read(
        self,
        model: str,
        domain: list[Any] | None = None,
        fields: list[str] | None = None,
        limit: int = 0,
        offset: int = 0,
        order: str | None = None,
    ) -> list[dict[str, Any]]:
        kwargs: dict[str, Any] = {}
        if fields is not None:
            kwargs["fields"] = fields
        if limit:
            kwargs["limit"] = limit
        if offset:
            kwargs["offset"] = offset
        if order:
            kwargs["order"] = order
        result = self.execute_kw(model, "search_read", [domain or []], kwargs)
        if not isinstance(result, list):
            raise OdooError("Unexpected search_read response")
        return result

    def fields_get(self, model: str) -> dict[str, Any]:
        result = self.execute_kw(model, "fields_get", [], {"attributes": ["string", "type"]})
        if not isinstance(result, dict):
            raise OdooError("Unexpected fields_get response")
        return result
