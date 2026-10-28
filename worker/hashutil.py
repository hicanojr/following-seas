"""sha256 of stored text. UTF-8, no extra trimming. Matches src/lib/resume/hash.ts."""

from __future__ import annotations

import hashlib


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
