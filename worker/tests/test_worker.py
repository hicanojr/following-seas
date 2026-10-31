"""Unit tests for the JobSpy worker. They do not install JobSpy, torch, or call a network."""

from __future__ import annotations

import hashlib
import unittest
from types import SimpleNamespace

from worker.config import Config, ConfigError
from worker.dedupe import dedupe_key, merge_batch
from worker.gaps import missing_terms, phrase_in_text, required_terms
from worker.gates import GateError, assert_allowed
from worker.hashutil import sha256_text
from worker.noise import filter_noise, noise_hit
from worker.plan import plan_queries, query_location
from worker.resume_parse import needs_parse, sanitize_resume
from worker.run import RunDeps, run_once
from worker.salary import annual_pay, salary_bounds
from worker.scrape import build_scrape_kwargs, normalize_row, scrape_jobspy
from worker.supabase_store import SupabaseStore
from worker.urls import http_url, posting_url


class DedupeTests(unittest.TestCase):
    def test_matches_the_sql_and_typescript_key(self) -> None:
        self.assertEqual(
            dedupe_key("Acme Health", "Director, Lab", "Boston, MA"),
            "acme health|director, lab|boston, ma",
        )
        self.assertEqual(dedupe_key(None, "Director", None), "|director|")
        self.assertEqual(dedupe_key(None, None, None), "||")
        self.assertEqual(
            dedupe_key("QUEST Diagnostics", "Director of Operations", "Marlborough, MA"),
            dedupe_key("Quest Diagnostics", "director of operations", "MARLBOROUGH, MA"),
        )
        self.assertEqual(dedupe_key(" Acme ", "Lab  Director", ""), " acme |lab  director|")

    def test_merge_keeps_the_first_and_borrows_a_missing_url(self) -> None:
        jobs = [
            {"company": "Acme", "title": "Director", "location": "Boston", "url": None},
            {"company": "ACME", "title": "Director", "location": "Boston", "url": "https://boards.example/1"},
            {"company": "Other", "title": "Director", "location": "Boston", "url": "https://boards.example/2"},
        ]
        merged = merge_batch(jobs)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["url"], "https://boards.example/1")


class UrlTests(unittest.TestCase):
    def test_prefers_the_direct_posting_and_rejects_non_http(self) -> None:
        self.assertEqual(
            posting_url({"job_url": "https://www.indeed.com/viewjob?jk=1", "job_url_direct": "https://hospital.example/jobs/1"}),
            "https://hospital.example/jobs/1",
        )
        self.assertEqual(posting_url({"job_url": "https://www.indeed.com/viewjob?jk=1"}), "https://www.indeed.com/viewjob?jk=1")
        self.assertIsNone(posting_url({"job_url": "javascript:alert(1)", "job_url_direct": "not a url"}))
        self.assertIsNone(http_url("mailto:jobs@example.com"))


class SalaryTests(unittest.TestCase):
    def test_annualizes_hourly_weekly_and_monthly(self) -> None:
        self.assertEqual(annual_pay(50, "hourly"), 104_000)
        self.assertEqual(annual_pay(1000, "weekly"), 52_000)
        self.assertEqual(annual_pay(5000, "monthly"), 60_000)
        self.assertEqual(salary_bounds(180_000, 40, "yearly"), (40, 180_000))


class NoiseTests(unittest.TestCase):
    def test_matches_whole_words_like_the_app(self) -> None:
        self.assertEqual(noise_hit("Registered Nurse", ["nurse"]), "nurse")
        self.assertEqual(noise_hit("RN Manager", ["RN"]), "RN")
        self.assertIsNone(noise_hit("Eastern Regional Director", ["RN"]))
        kept, dropped = filter_noise(
            [{"title": "Lab Director"}, {"title": "Registered Nurse"}],
            ["nurse"],
        )
        self.assertEqual([job["title"] for job in kept], ["Lab Director"])
        self.assertEqual(len(dropped), 1)


class GapTests(unittest.TestCase):
    def test_lists_required_terms_missing_from_the_resume(self) -> None:
        description = "About us\nWe run hospitals.\n\nRequirements\n- CLIA experience\n- HPLC\n\nBenefits\n- Dental"
        terms = required_terms(description, ["ASCP"], "blood bank, team player")
        self.assertIn("CLIA experience", terms)
        self.assertIn("HPLC", terms)
        self.assertIn("ASCP", terms)
        missing = missing_terms(
            description,
            ["ASCP"],
            "blood bank",
            "HPLC methods in a hospital lab.",
            {"skills": ["blood bank"], "credentials": ["ASCP"]},
        )
        self.assertEqual(missing, ["CLIA experience"])
        self.assertTrue(phrase_in_text("blood bank", "trained in blood bank"))
        self.assertFalse(phrase_in_text("RN", "Eastern Regional"))


class ResumeCacheTests(unittest.TestCase):
    def test_hash_matches_the_well_known_sha256_of_hello(self) -> None:
        self.assertEqual(sha256_text("hello"), hashlib.sha256(b"hello").hexdigest())
        self.assertEqual(
            sha256_text("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        )

    def test_reuses_a_parse_until_the_text_changes(self) -> None:
        text = "HPLC in a hospital lab."
        digest = sha256_text(text)
        parsed = {"skills": ["HPLC"]}
        self.assertFalse(needs_parse(text, digest, parsed))
        self.assertTrue(needs_parse(text + " More.", digest, parsed))
        self.assertTrue(needs_parse(text, digest, {}))
        self.assertFalse(needs_parse("   ", digest, None))

    def test_sanitize_keeps_only_written_fields(self) -> None:
        cleaned = sanitize_resume(
            {
                "name": "Ada",
                "skills": [" HPLC ", ""],
                "invented": ["Nobel prize"],
                "experience": [{"title": "Manager", "organization": "Acme", "highlights": ["Ran the lab"]}],
            }
        )
        self.assertEqual(cleaned["skills"], ["HPLC"])
        self.assertNotIn("invented", cleaned)
        self.assertEqual(cleaned["experience"][0]["title"], "Manager")
        self.assertIsNone(cleaned["experience"][0]["dates"])


class ScrapeGuardTests(unittest.TestCase):
    def _config(self) -> dict:
        return {"results_wanted": 100, "hours_old": 72, "country": "USA", "fetch_description": True}

    def test_builds_an_indeed_call_without_linkedin_or_easy_apply(self) -> None:
        kwargs = build_scrape_kwargs("indeed", "Lab Director", "Boston, MA", self._config())
        self.assertEqual(kwargs["site_name"], ["indeed"])
        self.assertEqual(kwargs["results_wanted"], 50)
        self.assertNotIn("easy_apply", kwargs)
        self.assertNotIn("proxies", kwargs)
        self.assertNotIn("linkedin", kwargs["site_name"])
        self.assertFalse(kwargs["enforce_annual_salary"])

    def test_google_uses_google_search_term(self) -> None:
        kwargs = build_scrape_kwargs("google", "Lab Director", "Boston, MA", self._config())
        self.assertEqual(kwargs["site_name"], ["google"])
        self.assertIn("jobs near Boston, MA", kwargs["google_search_term"])

    def test_ziprecruiter_site_name(self) -> None:
        kwargs = build_scrape_kwargs("ziprecruiter", "Lab Director", None, self._config())
        self.assertEqual(kwargs["site_name"], ["zip_recruiter"])
        self.assertEqual(kwargs["location"], "United States")

    def test_linkedin_is_refused(self) -> None:
        with self.assertRaises(GateError) as caught:
            build_scrape_kwargs("linkedin", "Lab Director", "Boston", self._config())
        self.assertEqual(caught.exception.action, "linkedin_login")

    def test_scrape_entry_refuses_easy_apply_before_calling_the_library(self) -> None:
        with self.assertRaises(GateError):
            scrape_jobspy({"site_name": ["indeed"], "easy_apply": True})

    def test_normalize_keeps_the_url_and_never_marks_easy_apply(self) -> None:
        job = normalize_row(
            {
                "site": "indeed",
                "title": "Lab Director",
                "company": "Acme",
                "location": "Boston, MA",
                "job_url": "https://www.indeed.com/viewjob?jk=1",
                "job_url_direct": "https://hospital.example/jobs/1",
                "min_amount": 50,
                "max_amount": 60,
                "interval": "hourly",
                "description": "Requirements\n- CLIA\n",
                "date_posted": "2026-10-01",
            },
            "indeed",
        )
        assert job is not None
        self.assertEqual(job["url"], "https://hospital.example/jobs/1")
        self.assertEqual(job["easy_apply"], "unknown")
        self.assertEqual(job["salary_min"], 104_000)
        self.assertEqual(job["salary_max"], 124_800)
        self.assertIn("CLIA", job["requirements"])
        self.assertIsNone(normalize_row({"site": "linkedin", "title": "Secret"}, "indeed"))


class PlanTests(unittest.TestCase):
    def test_skips_linkedin_noise_and_retired_and_runs_stalest_first(self) -> None:
        profiles = {"p1": {"id": "p1", "locations": ["Boston, MA"], "deleted_at": None, "scoring_rubric": {}}}
        queries = [
            {"id": "li", "profile_id": "p1", "source": "linkedin", "retired": False, "quality": "good", "last_run_at": None},
            {"id": "noise", "profile_id": "p1", "source": "indeed", "retired": True, "quality": "noise", "last_run_at": None},
            {"id": "old", "profile_id": "p1", "source": "glassdoor", "retired": False, "quality": "good", "last_run_at": None, "query_text": "A"},
            {"id": "new", "profile_id": "p1", "source": "google", "retired": False, "quality": "good", "last_run_at": "2026-10-01", "query_text": "B"},
        ]
        planned, skipped = plan_queries(queries, profiles, cap=1)
        self.assertEqual([query["id"] for query in planned], ["old"])
        reasons = {item["id"]: item["reason"] for item in skipped}
        self.assertIn("linkedin", reasons["li"])
        self.assertIn("retired", reasons["noise"])
        self.assertIn("cap", reasons["new"])
        self.assertEqual(query_location({"filters": {"location": "Austin, TX"}}, profiles["p1"]), "Austin, TX")
        self.assertEqual(query_location({"filters": {}}, profiles["p1"]), "Boston, MA")


class GateTests(unittest.TestCase):
    def test_forbidden_actions_stay_forbidden(self) -> None:
        assert_allowed("search")
        assert_allowed("import")
        assert_allowed("dedupe")
        for action in ("submit_application", "easy_apply", "send_email", "message_recruiter", "linkedin_login", "use_li_at_cookie", "hard_delete"):
            with self.assertRaises(GateError):
                assert_allowed(action)


class ConfigTests(unittest.TestCase):
    def test_requires_the_url_and_service_role_key(self) -> None:
        with self.assertRaises(ConfigError) as caught:
            Config.from_env({})
        self.assertIn("SUPABASE_URL", str(caught.exception))
        self.assertNotIn("secret-value", str(caught.exception))
        config = Config.from_env(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "secret-value",
                "JOBSPY_RESULTS_WANTED": "10",
            }
        )
        self.assertEqual(config.results_wanted, 10)
        self.assertIsNone(config.anthropic_api_key)
        self.assertEqual(config.embedding_model, "sentence-transformers/all-MiniLM-L6-v2")


def _vector() -> list[float]:
    return [0.01] * 384


class FakeStore:
    def __init__(self) -> None:
        self.resume = {
            "raw_text": "HPLC in a hospital lab.",
            "content_hash": None,
            "parsed": None,
            "embedded_at": None,
        }
        self.queries = [
            {
                "id": "q-indeed",
                "profile_id": "p1",
                "source": "indeed",
                "query_text": "Lab Director",
                "filters": {"location": "Boston, MA"},
                "retired": False,
                "quality": "good",
                "runs": 0,
                "total_hits": 0,
                "last_run_at": None,
            },
            {
                "id": "q-li",
                "profile_id": "p1",
                "source": "linkedin",
                "query_text": "Lab Director",
                "filters": {},
                "retired": False,
                "quality": "good",
                "runs": 0,
                "total_hits": 0,
                "last_run_at": None,
            },
        ]
        self.profiles = [
            {"id": "p1", "locations": ["Boston, MA"], "scoring_rubric": {}, "deleted_at": None}
        ]
        self.jobs: dict[str, dict] = {
            "existing": {
                "id": "existing",
                "company": "Acme",
                "title": "Lab Director",
                "location": "Boston, MA",
                "url": None,
                "deleted_at": None,
                "description": "Requirements\n- CLIA\n",
                "requirements": ["CLIA"],
            }
        }
        self.embeddings: dict[str, str] = {}
        self.gaps: dict[str, dict] = {}
        self.runs: list[dict] = []
        self.audits: list[dict] = []
        self.query_updates: list[dict] = []

    def list_user_ids(self) -> list[str]:
        return ["user-1"]

    def get_resume(self, user_id: str) -> dict | None:
        return self.resume

    def save_parsed_resume(self, user_id: str, parsed: dict, model: str, content_hash: str) -> None:
        self.resume["parsed"] = parsed
        self.resume["content_hash"] = content_hash

    def save_resume_embedding(self, user_id: str, vector: list[float], model: str, content_hash: str) -> None:
        self.resume["embedded_at"] = "now"
        self.resume["content_hash"] = content_hash
        self.resume["vector_len"] = len(vector)

    def list_queries(self, user_id: str) -> list[dict]:
        return self.queries

    def list_profiles(self, user_id: str) -> list[dict]:
        return self.profiles

    def find_jobs_by_keys(self, user_id: str, keys: list[str]) -> dict[str, dict]:
        found = {}
        for job in self.jobs.values():
            key = dedupe_key(job.get("company"), job.get("title"), job.get("location"))
            if key in keys:
                found[key] = job
        return found

    def insert_job(self, user_id: str, job: dict) -> str:
        new_id = f"job-{len(self.jobs) + 1}"
        self.jobs[new_id] = {"id": new_id, "deleted_at": None, **job}
        return new_id

    def fill_url(self, user_id: str, job_id: str, url: str) -> None:
        self.jobs[job_id]["url"] = url

    def update_query(self, user_id: str, query_id: str, runs: int, total_hits: int, last_run_at: str) -> None:
        self.query_updates.append({"id": query_id, "runs": runs, "total_hits": total_hits})

    def jobs_needing_embeddings(self, user_id: str, limit: int) -> list[dict]:
        from worker.hashutil import sha256_text
        from worker.text import job_embed_text

        needed = []
        for job in self.jobs.values():
            if job.get("deleted_at"):
                continue
            text = job_embed_text(job)
            digest = sha256_text(text)
            if self.embeddings.get(job["id"]) == digest:
                continue
            needed.append({"job_id": job["id"], "text": text, "content_hash": digest})
            if len(needed) >= limit:
                break
        return needed

    def save_job_embeddings(self, user_id: str, rows: list[dict], model: str) -> None:
        for row in rows:
            self.embeddings[row["job_id"]] = row["content_hash"]

    def jobs_for_gaps(self, user_id: str) -> list[dict]:
        out = []
        for job in self.jobs.values():
            out.append(
                {
                    "id": job["id"],
                    "description": job.get("description"),
                    "requirements": job.get("requirements") or [],
                    "gap_resume_hash": (self.gaps.get(job["id"]) or {}).get("resume_hash"),
                }
            )
        return out

    def save_keyword_gap(self, user_id: str, job_id: str, missing: list[str], resume_hash: str) -> None:
        self.gaps[job_id] = {"missing": missing, "resume_hash": resume_hash}

    def start_run(self, user_id: str, payload: dict) -> str:
        self.runs.append({"status": "running", "input": payload})
        return "run-1"

    def finish_run(self, user_id: str, run_id: str | None, status: str, output: dict | None, error: str | None) -> None:
        self.runs.append({"status": status, "output": output, "error": error})

    def audit(self, user_id: str, action: str, details: dict) -> None:
        self.audits.append({"action": action, "details": details})


class RunTests(unittest.TestCase):
    def test_imports_dedupes_fills_urls_parses_once_and_suggests_keywords(self) -> None:
        store = FakeStore()
        scrapes: list[dict] = []
        parses: list[str] = []
        embeds: list[int] = []

        def scrape(kwargs: dict) -> list[dict]:
            scrapes.append(kwargs)
            self.assertNotIn("easy_apply", kwargs)
            self.assertNotIn("linkedin", kwargs["site_name"])
            return [
                {
                    "site": "indeed",
                    "title": "Lab Director",
                    "company": "Acme",
                    "location": "Boston, MA",
                    "job_url_direct": "https://hospital.example/jobs/1",
                    "description": "Requirements\n- CLIA\n",
                },
                {
                    "site": "indeed",
                    "title": "Core Lab Manager",
                    "company": "Beta",
                    "location": "Cambridge, MA",
                    "job_url": "https://www.indeed.com/viewjob?jk=2",
                    "description": "Requirements\n- HPLC\n- Donor pheresis\n",
                },
                {
                    "site": "indeed",
                    "title": "Registered Nurse",
                    "company": "Beta",
                    "location": "Cambridge, MA",
                    "job_url": "https://www.indeed.com/viewjob?jk=3",
                },
                {"site": "linkedin", "title": "Should be dropped", "company": "Beta", "location": "Cambridge, MA"},
            ]

        def embed(texts: list[str]) -> list[list[float]]:
            embeds.append(len(texts))
            return [_vector() for _ in texts]

        def parse_resume(raw_text: str) -> dict:
            parses.append(raw_text)
            return sanitize_resume({"skills": ["HPLC"], "credentials": []})

        config = Config.from_env(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "ANTHROPIC_API_KEY": "test-key",
            }
        )
        deps = RunDeps(config=config, store=store, scrape=scrape, embed=embed, parse_resume=parse_resume)
        first = run_once(deps)
        self.assertEqual(first["failed"], 0)
        self.assertEqual(len(scrapes), 1)
        self.assertEqual(scrapes[0]["site_name"], ["indeed"])
        self.assertEqual(store.jobs["existing"]["url"], "https://hospital.example/jobs/1")
        self.assertTrue(any(job["title"] == "Core Lab Manager" for job in store.jobs.values()))
        self.assertFalse(any(job["title"] == "Registered Nurse" for job in store.jobs.values()))
        self.assertFalse(any(job["title"] == "Should be dropped" for job in store.jobs.values()))
        self.assertEqual(len(parses), 1)
        self.assertEqual(store.audits[0]["action"], "search")
        manager = next(job for job in store.jobs.values() if job["title"] == "Core Lab Manager")
        self.assertIn("Donor pheresis", store.gaps[manager["id"]]["missing"])
        self.assertNotIn("HPLC", store.gaps[manager["id"]]["missing"])
        self.assertTrue(all(job.get("easy_apply", "unknown") == "unknown" for job in store.jobs.values()))

        run_once(deps)
        self.assertEqual(len(parses), 1)
        self.assertEqual(len(scrapes), 2)

    def test_all_searches_failing_increments_the_failed_count(self) -> None:
        store = FakeStore()

        def scrape(_kwargs: dict) -> list[dict]:
            raise RuntimeError("search unavailable")

        config = Config.from_env(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "ANTHROPIC_API_KEY": "test-key",
            }
        )
        deps = RunDeps(
            config=config,
            store=store,
            scrape=scrape,
            embed=lambda texts: [_vector() for _ in texts],
            parse_resume=lambda _text: sanitize_resume({"skills": [], "credentials": []}),
        )

        result = run_once(deps)

        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["summaries"][0]["status"], "failed")


class _FakeQuery:
    """Just enough of the supabase-py query chain to filter in-memory rows."""

    def __init__(self, rows: list[dict], require_user_scope: bool = False, user_scoped: bool = False) -> None:
        self.rows = rows
        self.require_user_scope = require_user_scope
        self.user_scoped = user_scoped

    def select(self, *_args: object) -> "_FakeQuery":
        return self

    def limit(self, _n: int) -> "_FakeQuery":
        return self

    def eq(self, column: str, value: object) -> "_FakeQuery":
        return _FakeQuery(
            [r for r in self.rows if r.get(column) == value],
            self.require_user_scope,
            self.user_scoped or column == "user_id",
        )

    def in_(self, column: str, values: list) -> "_FakeQuery":
        if self.require_user_scope and column == "user_id" and len(values) > 100:
            raise AssertionError("brief_settings query must use bounded user batches")
        return _FakeQuery(
            [r for r in self.rows if r.get(column) in values],
            self.require_user_scope,
            self.user_scoped or column == "user_id",
        )

    def execute(self) -> SimpleNamespace:
        if self.require_user_scope and not self.user_scoped:
            raise AssertionError("brief_settings query must be scoped to candidate users")
        return SimpleNamespace(data=self.rows)


class _FakeClient:
    def __init__(self, tables: dict[str, list[dict]]) -> None:
        self.tables = tables

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.tables.get(name, []), require_user_scope=name == "brief_settings")


class DailyRunOptOutTests(unittest.TestCase):
    """brief_settings.daily_run = false keeps a person out of the scheduled worker."""

    def _store(self, settings: list[dict], only_user_id: str | None = None) -> SupabaseStore:
        store = SupabaseStore.__new__(SupabaseStore)  # skip create_client; no network
        store.only_user_id = only_user_id
        store.sb = _FakeClient(
            {
                "queries": [{"user_id": "u-on", "source": "indeed", "retired": False},
                            {"user_id": "u-off", "source": "indeed", "retired": False},
                            {"user_id": "u-none", "source": "google", "retired": False}],
                "resumes": [{"user_id": "u-resume-only"}],
                "brief_settings": settings,
            }
        )
        return store

    def test_daily_run_false_is_excluded(self) -> None:
        store = self._store([{"user_id": "u-off", "daily_run": False}])
        self.assertEqual(store.list_user_ids(), ["u-none", "u-on", "u-resume-only"])

    def test_daily_run_true_is_included(self) -> None:
        store = self._store([{"user_id": "u-off", "daily_run": True}])
        self.assertIn("u-off", store.list_user_ids())

    def test_missing_settings_row_keeps_the_default_on(self) -> None:
        store = self._store([])
        self.assertEqual(store.list_user_ids(), ["u-none", "u-off", "u-on", "u-resume-only"])

    def test_explicit_user_run_ignores_the_opt_out(self) -> None:
        store = self._store([{"user_id": "u-off", "daily_run": False}], only_user_id="u-off")
        self.assertEqual(store.list_user_ids(), ["u-off"])


if __name__ == "__main__":
    unittest.main()
