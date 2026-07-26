"""SSRF defenses for admin-supplied outbound hosts (Odoo URL, SMTP)."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        return True
    for net in _BLOCKED_NETWORKS:
        if ip in net:
            return True
    return False


def validate_public_https_url(url: str, *, field_name: str = "URL") -> str:
    """Require https URL whose resolved addresses are not private/link-local."""
    raw = (url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"{field_name} is required")
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise HTTPException(status_code=400, detail=f"{field_name} must use https://")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail=f"{field_name} is missing a hostname")
    if host.lower() in ("localhost", "metadata.google.internal"):
        raise HTTPException(status_code=400, detail=f"{field_name} host is not allowed")

    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail=f"Could not resolve {field_name} host") from exc

    if not infos:
        raise HTTPException(status_code=400, detail=f"Could not resolve {field_name} host")

    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if _is_blocked_ip(ip):
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} must not point to a private or internal address",
            )

    return raw.rstrip("/")


def validate_smtp_host(host: str) -> str:
    """Block SMTP hosts that resolve to private/link-local addresses."""
    raw = (host or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="SMTP host is required")
    if raw.lower() in ("localhost", "127.0.0.1", "::1"):
        raise HTTPException(status_code=400, detail="SMTP host is not allowed")

    # Host may be hostname or literal IP
    try:
        ip = ipaddress.ip_address(raw)
        if _is_blocked_ip(ip):
            raise HTTPException(status_code=400, detail="SMTP host must not be a private address")
        return raw
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(raw, 25, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="Could not resolve SMTP host") from exc

    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if _is_blocked_ip(ip):
            raise HTTPException(
                status_code=400,
                detail="SMTP host must not point to a private or internal address",
            )
    return raw
