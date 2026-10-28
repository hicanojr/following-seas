"""Title noise filter. Keyword list and matching follow src/lib/search/noise.ts."""

from __future__ import annotations

import re

# Keep in step with DEFAULT_NOISE_KEYWORDS in src/lib/search/noise.ts.
DEFAULT_NOISE_KEYWORDS = (
    "nurse",
    "nursing",
    "RN",
    "CRNA",
    "physician",
    "cannabis",
    "petroleum",
    "research scientist",
    "dental",
    "dentist",
    "pharmacist",
    "forensic",
    "food testing",
    "agricultural",
)


def _strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def resolve_noise_keywords(*sources: dict | None) -> list[str]:
    add: list[str] = []
    allow: list[str] = []
    for source in sources:
        if not source:
            continue
        add.extend(_strings(source.get("noise_keywords")))
        allow.extend(_strings(source.get("noise_allow")))
    allowed = {item.lower() for item in allow}
    seen: set[str] = set()
    out: list[str] = []
    for keyword in [*DEFAULT_NOISE_KEYWORDS, *add]:
        key = keyword.strip().lower()
        if not key or key in allowed or key in seen:
            continue
        seen.add(key)
        out.append(keyword.strip())
    return out


def _match(title: str, keyword: str) -> bool:
    pattern = re.compile(
        rf"(?:^|[^a-z0-9]){re.escape(keyword.lower())}s?(?:$|[^a-z0-9])",
        re.IGNORECASE,
    )
    return pattern.search(title.lower()) is not None


def noise_hit(title: str, keywords: list[str]) -> str | None:
    for keyword in keywords:
        if _match(title, keyword):
            return keyword
    return None


def filter_noise(jobs: list[dict], keywords: list[str]) -> tuple[list[dict], list[dict]]:
    kept: list[dict] = []
    dropped: list[dict] = []
    for job in jobs:
        hit = noise_hit(str(job.get("title") or ""), keywords)
        if hit:
            dropped.append(job)
        else:
            kept.append(job)
    return kept, dropped
