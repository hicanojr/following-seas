"""Parse the base resume once. Callers skip the API when the cache is still valid."""

from __future__ import annotations

import json
import re

from worker.hashutil import sha256_text

SYSTEM_PROMPT = """You extract a resume into JSON. You copy only what is written.

Rules:
- Never invent employers, titles, dates, credentials, skills, or numbers.
- If a field is not on the resume, use null or an empty list.
- skills and credentials are short phrases copied from the resume, not guesses.
- experience highlights are sentences copied or lightly trimmed, not rewritten into new claims.
- Return one JSON object and nothing else, with these keys:
  name, headline, location, credentials, skills, experience, education, other.
- experience items have title, organization, location, dates, highlights.
- education items have credential, institution, year.
"""


def needs_parse(raw_text: str, content_hash: str | None, parsed: object) -> bool:
    if not raw_text or not raw_text.strip():
        return False
    if not isinstance(parsed, dict) or not parsed:
        return True
    return content_hash != sha256_text(raw_text)


def _strings(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            out.append(item.strip()[:500])
        if len(out) >= limit:
            break
    return out


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()[:500]
    return None


def sanitize_resume(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Resume parse was not a JSON object")
    experience: list[dict] = []
    for item in raw.get("experience") or []:
        if not isinstance(item, dict):
            continue
        experience.append(
            {
                "title": _text(item.get("title")),
                "organization": _text(item.get("organization")),
                "location": _text(item.get("location")),
                "dates": _text(item.get("dates")),
                "highlights": _strings(item.get("highlights"), 12),
            }
        )
        if len(experience) >= 30:
            break
    education: list[dict] = []
    for item in raw.get("education") or []:
        if not isinstance(item, dict):
            continue
        education.append(
            {
                "credential": _text(item.get("credential")),
                "institution": _text(item.get("institution")),
                "year": _text(item.get("year")),
            }
        )
        if len(education) >= 15:
            break
    return {
        "name": _text(raw.get("name")),
        "headline": _text(raw.get("headline")),
        "location": _text(raw.get("location")),
        "credentials": _strings(raw.get("credentials"), 40),
        "skills": _strings(raw.get("skills"), 80),
        "experience": experience,
        "education": education,
        "other": _strings(raw.get("other"), 40),
    }


def parse_json_object(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    value = json.loads(cleaned)
    if not isinstance(value, dict):
        raise ValueError("Resume parse was not a JSON object")
    return value


def parse_resume_anthropic(raw_text: str, api_key: str, model: str) -> dict:
    """One Claude call. The result is cached by the worker; do not call this when needs_parse is false."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": raw_text[:60_000]}],
    )
    if getattr(response, "stop_reason", None) == "refusal":
        raise ValueError("The model declined to parse the resume.")
    parts = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return sanitize_resume(parse_json_object("".join(parts)))
