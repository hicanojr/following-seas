"""Text sent to the embedding model. The hash covers this exact string."""

from __future__ import annotations

EMBED_CHARS = 4000


def job_embed_text(job: dict) -> str:
    requirements = job.get("requirements") or []
    if isinstance(requirements, list):
        requirement_text = "\n".join(str(item) for item in requirements if item)
    else:
        requirement_text = str(requirements or "")
    parts = [
        str(job.get("title") or ""),
        str(job.get("company") or ""),
        str(job.get("location") or ""),
        str(job.get("description") or ""),
        requirement_text,
    ]
    return "\n".join(part for part in parts if part).strip()[:EMBED_CHARS]


def resume_embed_text(raw_text: str) -> str:
    return raw_text.strip()[:EMBED_CHARS]
