"""One worker pass: search, import, embed, parse the resume once, write keyword suggestions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from worker.dedupe import dedupe_key, merge_batch
from worker.gaps import missing_terms
from worker.gates import assert_allowed
from worker.hashutil import sha256_text
from worker.noise import filter_noise, resolve_noise_keywords
from worker.plan import plan_queries, query_location
from worker.resume_parse import needs_parse
from worker.scrape import build_scrape_kwargs, normalize_row
from worker.text import job_embed_text, resume_embed_text

EMBEDDING_DIM = 384


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_vector(vector: list[float]) -> None:
    if len(vector) != EMBEDDING_DIM:
        raise ValueError(f"Expected {EMBEDDING_DIM} dimensions from all-MiniLM, got {len(vector)}")


@dataclass
class RunDeps:
    config: object
    store: object
    scrape: Callable[[dict], list[dict]]
    embed: Callable[[list[str]], list[list[float]]]
    parse_resume: Callable[[str], dict]


def save_batch(store: object, user_id: str, jobs: list[dict]) -> dict:
    assert_allowed("dedupe")
    assert_allowed("import")
    merged = merge_batch(jobs)
    keys = [dedupe_key(job.get("company"), job.get("title"), job.get("location")) for job in merged]
    existing = store.find_jobs_by_keys(user_id, keys)
    inserted = 0
    url_filled = 0
    duplicates = 0
    for job in merged:
        key = dedupe_key(job.get("company"), job.get("title"), job.get("location"))
        row = existing.get(key)
        if row is None:
            new_id = store.insert_job(user_id, job)
            existing[key] = {"id": new_id, "url": job.get("url"), "deleted_at": None}
            inserted += 1
        elif row.get("deleted_at"):
            duplicates += 1
        elif not row.get("url") and job.get("url"):
            store.fill_url(user_id, row["id"], job["url"])
            row["url"] = job["url"]
            url_filled += 1
        else:
            duplicates += 1
    return {"inserted": inserted, "url_filled": url_filled, "duplicates": duplicates}


def run_user(deps: RunDeps, user_id: str) -> dict:
    config = deps.config
    store = deps.store
    resume = store.get_resume(user_id)
    parsed = None
    resume_hash = None
    parse_status = "none"
    if resume and str(resume.get("raw_text") or "").strip():
        raw_text = resume["raw_text"]
        resume_hash = sha256_text(raw_text)
        if needs_parse(raw_text, resume.get("content_hash"), resume.get("parsed")):
            if not config.anthropic_api_key:
                parse_status = "skipped_no_key"
            else:
                parsed = deps.parse_resume(raw_text)
                store.save_parsed_resume(user_id, parsed, config.resume_model, resume_hash)
                parse_status = "parsed"
        else:
            parsed = resume.get("parsed")
            parse_status = "reused"
        stale_embedding = resume.get("embedded_at") is None or resume.get("content_hash") != resume_hash
        if stale_embedding:
            vector = deps.embed([resume_embed_text(raw_text)])[0]
            _check_vector(vector)
            store.save_resume_embedding(user_id, vector, config.embedding_model, resume_hash)

    profiles = {row["id"]: row for row in store.list_profiles(user_id)}
    planned, skipped = plan_queries(store.list_queries(user_id), profiles, config.query_cap)
    inserted = url_filled = duplicates = noise = 0
    errors: list[dict] = []
    scrape_config = {
        "results_wanted": config.results_wanted,
        "hours_old": config.hours_old,
        "country": config.country,
        "fetch_description": config.fetch_description,
    }
    for query in planned:
        try:
            profile = profiles.get(query["profile_id"])
            kwargs = build_scrape_kwargs(query["source"], query["query_text"], query_location(query, profile), scrape_config)
            raw_rows = deps.scrape(kwargs)
            jobs = []
            for row in raw_rows:
                job = normalize_row(row, query["source"])
                if job:
                    jobs.append(job)
            rubric = (profile or {}).get("scoring_rubric") if isinstance((profile or {}).get("scoring_rubric"), dict) else {}
            filters = query.get("filters") if isinstance(query.get("filters"), dict) else {}
            kept, dropped = filter_noise(jobs, resolve_noise_keywords(rubric, filters))
            counts = save_batch(store, user_id, kept)
            inserted += counts["inserted"]
            url_filled += counts["url_filled"]
            duplicates += counts["duplicates"]
            noise += len(dropped)
            store.update_query(
                user_id,
                query["id"],
                runs=int(query.get("runs") or 0) + 1,
                total_hits=int(query.get("total_hits") or 0) + len(raw_rows),
                last_run_at=_now(),
            )
        except Exception as exc:
            errors.append({"query_id": query.get("id"), "error": str(exc)})

    targets = store.jobs_needing_embeddings(user_id, config.embed_limit)
    embedded = 0
    if targets:
        vectors = deps.embed([target["text"] for target in targets])
        if len(vectors) != len(targets):
            raise ValueError("Embedding count did not match the postings.")
        rows = []
        for target, vector in zip(targets, vectors):
            _check_vector(vector)
            rows.append({"job_id": target["job_id"], "embedding": vector, "content_hash": target["content_hash"]})
        store.save_job_embeddings(user_id, rows, config.embedding_model)
        embedded = len(rows)

    gaps_written = 0
    if parsed and resume_hash:
        for job in store.jobs_for_gaps(user_id):
            if job.get("gap_resume_hash") == resume_hash:
                continue
            missing = missing_terms(job.get("description"), job.get("requirements"), None, resume.get("raw_text"), parsed)
            store.save_keyword_gap(user_id, job["id"], missing, resume_hash)
            gaps_written += 1

    return {
        "parse": parse_status,
        "inserted": inserted,
        "url_filled": url_filled,
        "duplicates": duplicates,
        "noise": noise,
        "skipped_queries": skipped,
        "errors": errors,
        "embedded": embedded,
        "gaps": gaps_written,
    }


def run_once(deps: RunDeps) -> dict:
    assert_allowed("search")
    assert_allowed("import")
    assert_allowed("dedupe")
    summaries = []
    failed = 0
    for user_id in deps.store.list_user_ids():
        run_id = deps.store.start_run(user_id, {"kind": "jobspy"})
        try:
            outcome = run_user(deps, user_id)
            status = "failed" if outcome["errors"] and outcome["inserted"] == 0 and outcome["url_filled"] == 0 else "succeeded"
            deps.store.finish_run(user_id, run_id, status, outcome, None if status == "succeeded" else "One or more searches failed")
            deps.store.audit(user_id, "search", {"run_id": run_id, **{k: outcome[k] for k in ("inserted", "url_filled", "embedded", "gaps", "parse")}})
            summaries.append({"user_id": user_id, "status": status, **outcome})
            print(
                f"user={user_id} status={status} inserted={outcome['inserted']} "
                f"url_filled={outcome['url_filled']} embedded={outcome['embedded']} "
                f"gaps={outcome['gaps']} parse={outcome['parse']}"
            )
        except Exception as exc:
            failed += 1
            deps.store.finish_run(user_id, run_id, "failed", None, str(exc))
            summaries.append({"user_id": user_id, "status": "failed", "error": str(exc)})
            print(f"user={user_id} status=failed error={exc}")
    return {"users": len(summaries), "failed": failed, "summaries": summaries}
