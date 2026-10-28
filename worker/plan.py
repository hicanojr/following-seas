"""Which saved queries the worker runs. Stalest first, up to the cap.

LinkedIn and USAJobs are not in this list. Noise and retired queries are skipped.
"""

from __future__ import annotations

from worker.scrape import JOBSPY_SOURCES


def plan_queries(queries: list[dict], profiles: dict[str, dict], cap: int) -> tuple[list[dict], list[dict]]:
    skipped: list[dict] = []
    eligible: list[dict] = []
    for query in queries:
        source = query.get("source")
        if source not in JOBSPY_SOURCES:
            skipped.append({"id": query.get("id"), "reason": f"{source} is not a JobSpy source"})
            continue
        if query.get("retired") or query.get("quality") == "noise":
            skipped.append({"id": query.get("id"), "reason": "retired or noise"})
            continue
        profile = profiles.get(query.get("profile_id"))
        if not profile or profile.get("deleted_at"):
            skipped.append({"id": query.get("id"), "reason": "profile is not active"})
            continue
        eligible.append(query)

    def sort_key(query: dict) -> tuple:
        last = query.get("last_run_at")
        return (last is not None, last or "", str(query.get("id") or ""))

    eligible.sort(key=sort_key)
    limit = max(0, cap)
    for query in eligible[limit:]:
        skipped.append({"id": query.get("id"), "reason": "query cap reached"})
    return eligible[:limit], skipped


def query_location(query: dict, profile: dict | None) -> str | None:
    filters = query.get("filters") or {}
    location = filters.get("location") if isinstance(filters, dict) else None
    if isinstance(location, str) and location.strip():
        return location.strip()
    locations = (profile or {}).get("locations") or []
    if isinstance(locations, list):
        for item in locations:
            if isinstance(item, str) and item.strip():
                return item.strip()
    return None
