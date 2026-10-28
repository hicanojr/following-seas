"""Required-skill terms on a posting that do not appear in the resume.

The list is a suggestion. It is not a claim the person lacks the skill, and it
is not a reason to apply, skip, or message anyone.
"""

from __future__ import annotations

import re

_START = re.compile(
    r"^(?:requirements|required qualifications|minimum qualifications|qualifications|required skills|basic qualifications|what you(?:'|’)ll need|must have)\b",
    re.IGNORECASE,
)
_STOP = re.compile(
    r"^(?:responsibilities|what you(?:'|’)ll do|benefits|about us|about the|who we are|the role|overview|summary|equal opportunity|how to apply)\b",
    re.IGNORECASE,
)
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")
_GENERIC = {
    "experience",
    "required",
    "requirements",
    "preferred",
    "minimum",
    "qualifications",
    "responsibilities",
    "ability",
    "skills",
    "skill",
    "knowledge",
    "and",
    "or",
    "the",
    "a",
    "an",
    "to",
    "of",
    "in",
    "with",
    "for",
    "years",
    "year",
    "plus",
    "including",
    "other",
    "duties",
    "equivalent",
    "related",
    "field",
    "role",
    "position",
    "job",
}


def _clean_term(value: str) -> str | None:
    text = _BULLET.sub("", value).strip().strip(" .;:-")
    text = re.sub(r"\s+", " ", text)
    if len(text) < 2 or len(text) > 80:
        return None
    if text.lower() in _GENERIC:
        return None
    if not re.search(r"[a-zA-Z]", text):
        return None
    return text


def _split_phrases(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            parts.extend(_split_phrases(item))
        return parts
    if not isinstance(value, str):
        return []
    chunks = re.split(r"[\n;,•|]", value)
    out: list[str] = []
    for chunk in chunks:
        term = _clean_term(chunk)
        if term:
            out.append(term)
    return out


def _section_lines(description: str) -> list[str]:
    lines = description.splitlines()
    collecting = False
    blanks = 0
    found: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            blanks += 1
            if collecting and blanks >= 2:
                collecting = False
            continue
        blanks = 0
        heading = line[:60]
        if _STOP.search(heading) and not _BULLET.search(line):
            collecting = False
            continue
        if _START.search(heading) and not _BULLET.search(line):
            collecting = True
            continue
        if collecting:
            found.append(line)
    return found


def required_terms(description: str | None, requirements: object, skills: object) -> list[str]:
    found: list[str] = []
    found.extend(_split_phrases(skills))
    found.extend(_split_phrases(requirements))
    if isinstance(description, str) and description.strip():
        for line in _section_lines(description):
            term = _clean_term(_BULLET.sub("", line))
            if term:
                found.append(term)
    seen: set[str] = set()
    unique: list[str] = []
    for term in found:
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(term)
        if len(unique) >= 40:
            break
    return unique


def phrase_in_text(phrase: str, haystack: str) -> bool:
    compact = re.sub(r"\s+", " ", phrase.strip().lower())
    if not compact:
        return False
    parts = compact.split(" ")
    body = r"\s+".join(re.escape(part) for part in parts)
    return re.search(rf"(?<![a-z0-9]){body}(?![a-z0-9])", haystack.lower()) is not None


def _flatten(value: object, out: list[str]) -> None:
    if isinstance(value, str):
        if value.strip():
            out.append(value.strip())
    elif isinstance(value, list):
        for item in value:
            _flatten(item, out)
    elif isinstance(value, dict):
        for item in value.values():
            _flatten(item, out)


def resume_haystack(raw_text: str | None, parsed: object) -> str:
    parts: list[str] = []
    if raw_text:
        parts.append(raw_text)
    _flatten(parsed, parts)
    return "\n".join(parts)


def missing_terms(
    description: str | None,
    requirements: object,
    skills: object,
    raw_text: str | None,
    parsed: object,
) -> list[str]:
    haystack = resume_haystack(raw_text, parsed)
    missing: list[str] = []
    for term in required_terms(description, requirements, skills):
        if not phrase_in_text(term, haystack):
            missing.append(term)
        if len(missing) >= 30:
            break
    return missing
