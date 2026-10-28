"""Run one JobSpy pass. `python -m worker` from the repository root, or from the image."""

from __future__ import annotations

import sys

from worker.config import Config, ConfigError
from worker.embeddings import embed_texts
from worker.resume_parse import parse_resume_anthropic
from worker.run import RunDeps, run_once
from worker.scrape import scrape_jobspy
from worker.supabase_store import SupabaseStore


def main() -> int:
    try:
        config = Config.from_env()
    except ConfigError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    def embed(texts: list[str]) -> list[list[float]]:
        return embed_texts(
            texts,
            config.embedding_provider,
            config.embedding_model,
            config.embedding_api_url,
            config.embedding_api_key,
        )

    def parse_resume(raw_text: str) -> dict:
        if not config.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set, so the resume cannot be parsed.")
        return parse_resume_anthropic(raw_text, config.anthropic_api_key, config.resume_model)

    store = SupabaseStore(config.supabase_url, config.service_role_key, config.user_id)
    result = run_once(
        RunDeps(config=config, store=store, scrape=scrape_jobspy, embed=embed, parse_resume=parse_resume)
    )
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
