"""Dedupe key. Must stay identical to src/lib/dedupe.ts and the generated column.

lower(coalesce(company, '')) || '|' || lower(coalesce(title, '')) || '|' || lower(coalesce(location, ''))

No trimming and no whitespace collapsing. If you change this, change the SQL and the TypeScript too.
"""

from __future__ import annotations


def _part(value: str | None) -> str:
    if value is None:
        return ""
    return str(value).lower()


def dedupe_key(company: str | None, title: str | None, location: str | None) -> str:
    return f"{_part(company)}|{_part(title)}|{_part(location)}"


def merge_batch(jobs: list[dict]) -> list[dict]:
    """Keep the first posting for each key. If a later copy has a URL and the first does not, keep the URL."""
    order: list[str] = []
    by_key: dict[str, dict] = {}
    for job in jobs:
        key = dedupe_key(job.get("company"), job.get("title"), job.get("location"))
        current = by_key.get(key)
        if current is None:
            by_key[key] = job
            order.append(key)
        elif not current.get("url") and job.get("url"):
            current["url"] = job["url"]
    return [by_key[key] for key in order]
