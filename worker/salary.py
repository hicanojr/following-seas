"""Annualize JobSpy pay. Hourly * 2080, weekly * 52, monthly * 12.

The stored salary_text keeps the posted interval. salary_min and salary_max are yearly dollars.
"""

from __future__ import annotations

import math


def _number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "").replace("$", "")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _annual_factor(interval: object) -> float:
    label = str(interval or "").strip().lower()
    if label in {"hour", "hourly", "hr"}:
        return 2080
    if label in {"week", "weekly"}:
        return 52
    if label in {"month", "monthly"}:
        return 12
    if label in {"day", "daily"}:
        return 260
    return 1


def annual_pay(amount: object, interval: object) -> int | None:
    number = _number(amount)
    if number is None or number < 0:
        return None
    yearly = number * _annual_factor(interval)
    if yearly > 2_000_000_000:
        return None
    return int(round(yearly))


def salary_bounds(min_amount: object, max_amount: object, interval: object) -> tuple[int | None, int | None]:
    low = annual_pay(min_amount, interval)
    high = annual_pay(max_amount, interval)
    if low is not None and high is not None and low > high:
        low, high = high, low
    return low, high


def salary_text(min_amount: object, max_amount: object, interval: object, currency: object) -> str | None:
    low = _number(min_amount)
    high = _number(max_amount)
    if low is None and high is None:
        return None
    unit = str(interval).strip() if isinstance(interval, str) and interval.strip() else None
    money = str(currency).strip() if isinstance(currency, str) and currency.strip() else "USD"

    def fmt(value: float) -> str:
        if value.is_integer():
            return f"{int(value):,}"
        return f"{value:,.2f}"

    if low is not None and high is not None and low != high:
        body = f"{fmt(low)}-{fmt(high)}"
    else:
        body = fmt(low if low is not None else high or 0)
    suffix = f" {unit}" if unit else ""
    return f"{money} {body}{suffix}"
