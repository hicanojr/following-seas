"""Environment for the worker. Names only; values stay in the host environment."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from worker.embeddings import DEFAULT_MODEL

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class ConfigError(Exception):
    pass


def _int(env: dict, name: str, default: int, low: int, high: int) -> int:
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return min(high, max(low, value))


def _bool(env: dict, name: str, default: bool) -> bool:
    raw = (env.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str
    anthropic_api_key: str | None
    user_id: str | None
    results_wanted: int
    hours_old: int
    country: str
    query_cap: int
    embed_limit: int
    fetch_description: bool
    embedding_provider: str
    embedding_model: str
    embedding_api_url: str | None
    embedding_api_key: str | None
    resume_model: str

    @staticmethod
    def from_env(env: dict | None = None) -> Config:
        source = env if env is not None else os.environ
        url = (source.get("SUPABASE_URL") or source.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
        key = (source.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if not url or not key:
            raise ConfigError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Do not commit them.")
        user_id = (source.get("JOBSPY_USER_ID") or "").strip() or None
        if user_id and not _UUID.match(user_id):
            raise ConfigError("JOBSPY_USER_ID must be a user uuid.")
        provider = (source.get("EMBEDDING_PROVIDER") or "local").strip().lower()
        if provider not in {"local", "api"}:
            provider = "local"
        anthropic = (source.get("ANTHROPIC_API_KEY") or "").strip() or None
        return Config(
            supabase_url=url,
            service_role_key=key,
            anthropic_api_key=anthropic,
            user_id=user_id,
            results_wanted=_int(source, "JOBSPY_RESULTS_WANTED", 20, 1, 50),
            hours_old=_int(source, "JOBSPY_HOURS_OLD", 72, 1, 24 * 30),
            country=(source.get("JOBSPY_COUNTRY") or "USA").strip() or "USA",
            query_cap=_int(source, "JOBSPY_QUERY_CAP", 8, 0, 50),
            embed_limit=_int(source, "JOBSPY_EMBED_LIMIT", 200, 1, 1000),
            fetch_description=_bool(source, "JOBSPY_FETCH_DESCRIPTION", True),
            embedding_provider=provider,
            embedding_model=(source.get("EMBEDDING_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL,
            embedding_api_url=(source.get("EMBEDDING_API_URL") or "").strip() or None,
            embedding_api_key=(source.get("EMBEDDING_API_KEY") or "").strip() or None,
            resume_model=(source.get("RESUME_PARSE_MODEL") or "claude-haiku-5-5").strip() or "claude-haiku-5-5",
        )
