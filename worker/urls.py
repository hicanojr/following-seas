"""Posting URLs. Only http(s) links are kept."""

from __future__ import annotations

from urllib.parse import urlparse


def http_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return text


def posting_url(row: dict) -> str | None:
    """Direct posting link when JobSpy has one, otherwise the board listing URL."""
    direct = http_url(row.get("job_url_direct"))
    if direct:
        return direct
    return http_url(row.get("job_url"))
