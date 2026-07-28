"""Cloudflare R2 (S3-compatible) helpers for private certificate objects."""

from __future__ import annotations

import logging
from typing import Any, Optional
from uuid import uuid4

from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

PDF_CONTENT_TYPE = "application/pdf"
PDF_EXTENSION = ".pdf"
_GENERIC_STORAGE_ERROR = "Certificate storage unavailable"


def require_r2(settings: Optional[Settings] = None) -> Settings:
    cfg = settings or get_settings()
    if not cfg.r2_ready:
        raise HTTPException(
            status_code=503,
            detail="Certificate storage is not configured (Cloudflare R2).",
        )
    return cfg


def _client(settings: Settings):
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id.strip(),
        aws_secret_access_key=settings.r2_secret_access_key.strip(),
        region_name=(settings.r2_region or "auto").strip() or "auto",
        config=Config(signature_version="s3v4"),
    )


def assert_tenant_object_key(tenant_id: int, object_key: str) -> str:
    """Defense-in-depth: only allow keys under tenants/{tenant_id}/."""
    key = (object_key or "").strip()
    if not key or ".." in key or key.startswith("/") or "\\" in key:
        raise HTTPException(status_code=403, detail="Invalid certificate storage key")
    expected = f"tenants/{int(tenant_id)}/"
    if not key.startswith(expected):
        raise HTTPException(status_code=403, detail="Invalid certificate storage key")
    return key


def validate_pdf_upload(file_name: str, size_bytes: int, max_bytes: int) -> str:
    name = (file_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="File name is required")
    lower = name.lower()
    if not lower.endswith(PDF_EXTENSION):
        raise HTTPException(status_code=400, detail="Only PDF documents are supported")
    # Reject path tricks
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid file name")
    if size_bytes <= 0:
        raise HTTPException(status_code=400, detail="File is empty")
    if size_bytes > max_bytes:
        mb = max_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the {mb:g} MB size limit",
        )
    return name


def build_object_key(*, tenant_id: int, equipment_public_id: str) -> str:
    return f"tenants/{tenant_id}/equipment/{equipment_public_id}/certs/{uuid4().hex}.pdf"


def _raise_storage_unavailable(exc: ClientError, *, action: str) -> None:
    err = exc.response.get("Error") or {}
    code = str(err.get("Code") or "").strip()
    message = str(err.get("Message") or "").strip()
    logger.warning("r2.%s_failed code=%s message=%s", action, code or "?", message or "?")
    raise HTTPException(status_code=502, detail=_GENERIC_STORAGE_ERROR) from exc


def put_bytes(
    *,
    tenant_id: int,
    object_key: str,
    body: bytes,
    content_type: str = PDF_CONTENT_TYPE,
    settings: Optional[Settings] = None,
) -> dict[str, Any]:
    """Upload object bytes from the API (avoids browser→R2 CORS)."""
    key = assert_tenant_object_key(tenant_id, object_key)
    cfg = require_r2(settings)
    client = _client(cfg)
    try:
        return client.put_object(
            Bucket=cfg.r2_bucket.strip(),
            Key=key,
            Body=body,
            ContentType=content_type,
        )
    except ClientError as exc:
        _raise_storage_unavailable(exc, action="put_object")
        raise  # pragma: no cover


def presign_get(
    *,
    tenant_id: int,
    object_key: str,
    file_name: str,
    expires_in: Optional[int] = None,
    settings: Optional[Settings] = None,
) -> str:
    key = assert_tenant_object_key(tenant_id, object_key)
    cfg = require_r2(settings)
    ttl = expires_in if expires_in is not None else cfg.certificate_view_url_ttl_seconds
    client = _client(cfg)
    safe_name = (file_name or "certificate.pdf").replace('"', "")
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": cfg.r2_bucket.strip(),
            "Key": key,
            "ResponseContentType": PDF_CONTENT_TYPE,
            "ResponseContentDisposition": f'inline; filename="{safe_name}"',
        },
        ExpiresIn=max(15, int(ttl)),
    )


def head_object(
    *,
    tenant_id: int,
    object_key: str,
    settings: Optional[Settings] = None,
) -> dict[str, Any]:
    key = assert_tenant_object_key(tenant_id, object_key)
    cfg = require_r2(settings)
    client = _client(cfg)
    try:
        return client.head_object(Bucket=cfg.r2_bucket.strip(), Key=key)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=400, detail="Upload not found in storage") from exc
        _raise_storage_unavailable(exc, action="head_object")
        raise  # pragma: no cover


def delete_object(
    *,
    tenant_id: int,
    object_key: str,
    settings: Optional[Settings] = None,
) -> None:
    key = assert_tenant_object_key(tenant_id, object_key)
    cfg = require_r2(settings)
    client = _client(cfg)
    try:
        client.delete_object(Bucket=cfg.r2_bucket.strip(), Key=key)
    except ClientError as exc:
        _raise_storage_unavailable(exc, action="delete_object")
        raise  # pragma: no cover


def purge_tenant_prefix(*, tenant_id: int, settings: Optional[Settings] = None) -> int:
    """Best-effort delete of all R2 objects under tenants/{id}/. Returns deleted count."""
    cfg = settings or get_settings()
    if not cfg.r2_ready:
        return 0
    prefix = f"tenants/{int(tenant_id)}/"
    client = _client(cfg)
    bucket = cfg.r2_bucket.strip()
    deleted = 0
    try:
        continuation: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
            if continuation:
                kwargs["ContinuationToken"] = continuation
            resp = client.list_objects_v2(**kwargs)
            objects = [{"Key": obj["Key"]} for obj in resp.get("Contents") or [] if obj.get("Key")]
            if objects:
                client.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True})
                deleted += len(objects)
            if not resp.get("IsTruncated"):
                break
            continuation = resp.get("NextContinuationToken")
    except ClientError as exc:
        logger.warning("r2_purge_tenant_failed tenant_id=%s err=%s", tenant_id, exc)
    return deleted
