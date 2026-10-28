"""Supabase writes for the worker.

The service role key bypasses Row Level Security. Every query filters by user_id.
The key is never printed.
"""

from __future__ import annotations

from datetime import datetime, timezone

from worker.dedupe import dedupe_key
from worker.hashutil import sha256_text
from worker.scrape import JOBSPY_SOURCES
from worker.text import job_embed_text


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class SupabaseStore:
    def __init__(self, url: str, service_role_key: str, only_user_id: str | None = None) -> None:
        from supabase import create_client

        self.sb = create_client(url, service_role_key)
        self.only_user_id = only_user_id

    def list_user_ids(self) -> list[str]:
        if self.only_user_id:
            return [self.only_user_id]
        found: set[str] = set()
        queries = (
            self.sb.table("queries")
            .select("user_id")
            .in_("source", list(JOBSPY_SOURCES))
            .eq("retired", False)
            .limit(5000)
            .execute()
        )
        resumes = self.sb.table("resumes").select("user_id").limit(5000).execute()
        for row in (queries.data or []) + (resumes.data or []):
            if row.get("user_id"):
                found.add(row["user_id"])
        return sorted(found)

    def get_resume(self, user_id: str) -> dict | None:
        response = (
            self.sb.table("resumes")
            .select("raw_text, content_hash, parsed, embedded_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    def save_parsed_resume(self, user_id: str, parsed: dict, model: str, content_hash: str) -> None:
        self.sb.table("resumes").update(
            {"parsed": parsed, "parsed_model": model, "parsed_at": _now(), "content_hash": content_hash}
        ).eq("user_id", user_id).execute()

    def save_resume_embedding(self, user_id: str, vector: list[float], model: str, content_hash: str) -> None:
        self.sb.table("resumes").update(
            {
                "embedding": vector,
                "embedding_model": model,
                "embedded_at": _now(),
                "content_hash": content_hash,
            }
        ).eq("user_id", user_id).execute()

    def list_queries(self, user_id: str) -> list[dict]:
        response = (
            self.sb.table("queries")
            .select("id, profile_id, source, query_text, filters, retired, quality, runs, total_hits, last_run_at")
            .eq("user_id", user_id)
            .in_("source", list(JOBSPY_SOURCES))
            .execute()
        )
        return response.data or []

    def list_profiles(self, user_id: str) -> list[dict]:
        response = (
            self.sb.table("profiles")
            .select("id, locations, scoring_rubric, deleted_at")
            .eq("user_id", user_id)
            .execute()
        )
        return response.data or []

    def find_jobs_by_keys(self, user_id: str, keys: list[str]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        for part in _chunks(list(dict.fromkeys(keys)), 100):
            if not part:
                continue
            response = (
                self.sb.table("jobs")
                .select("id, dedupe_key, url, deleted_at")
                .eq("user_id", user_id)
                .in_("dedupe_key", part)
                .execute()
            )
            for row in response.data or []:
                found[row["dedupe_key"]] = row
        return found

    def insert_job(self, user_id: str, job: dict) -> str:
        payload = {
            "user_id": user_id,
            "source": job["source"],
            "external_id": job.get("external_id"),
            "url": job.get("url"),
            "title": job["title"],
            "company": job.get("company"),
            "location": job.get("location"),
            "salary_min": job.get("salary_min"),
            "salary_max": job.get("salary_max"),
            "salary_text": job.get("salary_text"),
            "description": job.get("description"),
            "requirements": job.get("requirements") or [],
            "easy_apply": "unknown",
            "posted_at": job.get("posted_at"),
        }
        response = self.sb.table("jobs").insert(payload).execute()
        rows = response.data or []
        if not rows:
            raise RuntimeError("Inserting a posting returned no id.")
        return rows[0]["id"]

    def fill_url(self, user_id: str, job_id: str, url: str) -> None:
        (
            self.sb.table("jobs")
            .update({"url": url})
            .eq("id", job_id)
            .eq("user_id", user_id)
            .is_("deleted_at", "null")
            .execute()
        )

    def update_query(self, user_id: str, query_id: str, runs: int, total_hits: int, last_run_at: str) -> None:
        (
            self.sb.table("queries")
            .update({"runs": runs, "total_hits": total_hits, "last_run_at": last_run_at})
            .eq("id", query_id)
            .eq("user_id", user_id)
            .execute()
        )

    def jobs_needing_embeddings(self, user_id: str, limit: int) -> list[dict]:
        jobs = (
            self.sb.table("jobs")
            .select("id, title, company, location, description, requirements")
            .eq("user_id", user_id)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
        )
        existing = (
            self.sb.table("job_embeddings").select("job_id, content_hash").eq("user_id", user_id).limit(5000).execute()
        )
        hashes = {row["job_id"]: row["content_hash"] for row in existing.data or []}
        needed: list[dict] = []
        for job in jobs.data or []:
            text = job_embed_text(job)
            if not text:
                continue
            digest = sha256_text(text)
            if hashes.get(job["id"]) == digest:
                continue
            needed.append({"job_id": job["id"], "text": text, "content_hash": digest})
            if len(needed) >= limit:
                break
        return needed

    def save_job_embeddings(self, user_id: str, rows: list[dict], model: str) -> None:
        payload = [
            {
                "job_id": row["job_id"],
                "user_id": user_id,
                "embedding": row["embedding"],
                "embedding_model": model,
                "content_hash": row["content_hash"],
                "embedded_at": _now(),
            }
            for row in rows
        ]
        if payload:
            self.sb.table("job_embeddings").upsert(payload, on_conflict="job_id").execute()

    def jobs_for_gaps(self, user_id: str) -> list[dict]:
        jobs = (
            self.sb.table("jobs")
            .select("id, description, requirements")
            .eq("user_id", user_id)
            .is_("deleted_at", "null")
            .limit(500)
            .execute()
        )
        gaps = self.sb.table("keyword_gaps").select("job_id, resume_hash").eq("user_id", user_id).limit(5000).execute()
        hashes = {row["job_id"]: row.get("resume_hash") for row in gaps.data or []}
        out = []
        for job in jobs.data or []:
            out.append(
                {
                    "id": job["id"],
                    "description": job.get("description"),
                    "requirements": job.get("requirements") or [],
                    "gap_resume_hash": hashes.get(job["id"]),
                }
            )
        return out

    def save_keyword_gap(self, user_id: str, job_id: str, missing: list[str], resume_hash: str) -> None:
        self.sb.table("keyword_gaps").upsert(
            {
                "job_id": job_id,
                "user_id": user_id,
                "missing": missing,
                "resume_hash": resume_hash,
                "suggestions_only": True,
                "computed_at": _now(),
            },
            on_conflict="job_id",
        ).execute()

    def start_run(self, user_id: str, payload: dict) -> str | None:
        response = (
            self.sb.table("agent_runs")
            .insert({"user_id": user_id, "agent": "jobspy", "status": "running", "input": payload})
            .execute()
        )
        rows = response.data or []
        return rows[0]["id"] if rows else None

    def finish_run(self, user_id: str, run_id: str | None, status: str, output: dict | None, error: str | None) -> None:
        if not run_id:
            return
        (
            self.sb.table("agent_runs")
            .update({"status": status, "output": output, "error": error, "finished_at": _now()})
            .eq("id", run_id)
            .eq("user_id", user_id)
            .execute()
        )

    def audit(self, user_id: str, action: str, details: dict) -> None:
        self.sb.table("audit_log").insert(
            {"user_id": user_id, "actor": "jobspy", "action": action, "entity_table": "jobs", "details": details}
        ).execute()


def dedupe_of(job: dict) -> str:
    return dedupe_key(job.get("company"), job.get("title"), job.get("location"))
