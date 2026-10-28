"""Hard gates. Keep the lists identical to src/lib/gates.ts.

Changing either list is a product decision for the owner, not a refactor.
"""

from __future__ import annotations

ALLOWED_ACTIONS = (
    "search",
    "import",
    "dedupe",
    "score",
    "shortlist_suggest",
    "track",
    "remind",
    "draft",
)

FORBIDDEN_ACTIONS = (
    "submit_application",
    "easy_apply",
    "send_email",
    "message_recruiter",
    "linkedin_login",
    "use_li_at_cookie",
    "hard_delete",
)

_ALLOWED = set(ALLOWED_ACTIONS)
_FORBIDDEN = set(FORBIDDEN_ACTIONS)


class GateError(Exception):
    def __init__(self, action: str, reason: str) -> None:
        self.action = action
        self.reason = reason
        if reason == "forbidden":
            message = f'Action "{action}" is forbidden for agents. A person must do this themselves.'
        else:
            message = f'Action "{action}" is not on the agent allow-list.'
        super().__init__(message)


def assert_allowed(action: str) -> None:
    if action in _FORBIDDEN:
        raise GateError(action, "forbidden")
    if action not in _ALLOWED:
        raise GateError(action, "unknown")
