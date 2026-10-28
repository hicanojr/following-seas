"""Build JobSpy calls. LinkedIn is never requested. Easy Apply is never requested.

site_name is always an explicit list. JobSpy's default is every board, including LinkedIn.
"""

from __future__ import annotations

import math
from datetime import date, datetime

from worker.gaps import required_terms
from worker.gates import GateError, assert_allowed
from worker.salary import salary_bounds, salary_text
from worker.urls import posting_url

JOBSPY_SOURCES = ("indeed", "ziprecruiter", "glassdoor", "google")
SITE_NAME = {
    "indeed": "indeed",
    "ziprecruiter": "zip_recruiter",
    "glassdoor": "glassdoor",
    "google": "google",
}
ALLOWED_KWARGS = {
    "site_name",
    "search_term",
    "google_search_term",
    "location",
    "results_wanted",
    "hours_old",
    "country_indeed",
    "description_format",
    "verbose",
    "enforce_annual_salary",
    "fetch_description",
}
RESULTS_MAX = 50


def clamp_results(value: int) -> int:
    if value < 1:
        return 1
    if value > RESULTS_MAX:
        return RESULTS_MAX
    return value


def _clean(value: object) -> object:
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in {"nan", "none"}:
            return None
        return text
    return value


def _location(row: dict, fallback: str | None) -> str | None:
    location = _clean(row.get("location"))
    if isinstance(location, str):
        return location
    city = _clean(row.get("city"))
    state = _clean(row.get("state"))
    parts = [part for part in (city, state) if isinstance(part, str)]
    if parts:
        return ", ".join(parts)
    if row.get("is_remote") is True:
        return "Remote"
    return fallback


def _posted_at(value: object) -> str | None:
    value = _clean(value)
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str) and len(value) >= 10:
        return value[:10]
    return None


def build_scrape_kwargs(source: str, query_text: str, location: str | None, config: dict) -> dict:
    """config keys: results_wanted, hours_old, country, fetch_description."""
    assert_allowed("search")
    if source == "linkedin":
        raise GateError("linkedin_login", "forbidden")
    if source not in SITE_NAME:
        raise ValueError(f"JobSpy does not search {source}.")
    site = SITE_NAME[source]
    place = location.strip() if isinstance(location, str) and location.strip() else "United States"
    kwargs = {
        "site_name": [site],
        "search_term": query_text,
        "location": place,
        "results_wanted": clamp_results(int(config["results_wanted"])),
        "hours_old": int(config["hours_old"]),
        "country_indeed": config["country"],
        "description_format": "plain",
        "verbose": 0,
        "enforce_annual_salary": False,
        "fetch_description": bool(config["fetch_description"]),
    }
    if site == "google":
        kwargs["google_search_term"] = f"{query_text} jobs near {place}"
    unknown = set(kwargs) - ALLOWED_KWARGS
    if unknown:
        raise GateError("easy_apply", "forbidden")
    if "linkedin" in kwargs["site_name"]:
        raise GateError("linkedin_login", "forbidden")
    return kwargs


def normalize_row(row: dict, source: str) -> dict | None:
    site = str(_clean(row.get("site")) or "").lower().replace(" ", "")
    if site in {"linkedin", "linked_in"}:
        return None
    if source not in SITE_NAME:
        return None
    title = _clean(row.get("title"))
    if not isinstance(title, str) or not title:
        return None
    company = _clean(row.get("company"))
    location = _location(row, None)
    low, high = salary_bounds(row.get("min_amount"), row.get("max_amount"), row.get("interval"))
    description = _clean(row.get("description"))
    description_text = description if isinstance(description, str) else None
    if description_text and len(description_text) > 50_000:
        description_text = description_text[:50_000]
    external = _clean(row.get("id"))
    requirements = required_terms(description_text, None, row.get("skills"))
    return {
        "source": source,
        "external_id": str(external)[:500] if external is not None else None,
        "url": posting_url(row),
        "title": title,
        "company": company if isinstance(company, str) else None,
        "location": location,
        "salary_min": low,
        "salary_max": high,
        "salary_text": salary_text(row.get("min_amount"), row.get("max_amount"), row.get("interval"), row.get("currency")),
        "description": description_text,
        "requirements": requirements,
        "easy_apply": "unknown",
        "posted_at": _posted_at(row.get("date_posted")),
    }


def scrape_jobspy(kwargs: dict) -> list[dict]:
    """Call JobSpy. Imported here so unit tests do not install the scraper."""
    assert_allowed("search")
    if "easy_apply" in kwargs or "proxies" in kwargs or "linkedin_fetch_description" in kwargs:
        raise GateError("easy_apply", "forbidden")
    sites = kwargs.get("site_name") or []
    if any(site == "linkedin" for site in sites):
        raise GateError("linkedin_login", "forbidden")
    from jobspy import scrape_jobs

    frame = scrape_jobs(**kwargs)
    if frame is None or len(frame) == 0:
        return []
    return frame.to_dict(orient="records")
