/**
 * Salary text parsing. Turns posted pay such as "$155,000 - $185,000 a year",
 * "$75 an hour", or "Up to $200K" into annual USD figures.
 *
 * Rules:
 *   - Hourly pay is annualized at 2,080 hours; weekly at 52 weeks; monthly at 12.
 *   - The original text is always kept in salary_text so nothing is lost.
 *   - When a number cannot be read with confidence, min and max stay null.
 *     Never guess.
 */

export const HOURS_PER_YEAR = 2080;

export interface ParsedSalary {
  salary_min: number | null;
  salary_max: number | null;
  salary_text: string | null;
}

type Period = "year" | "hour" | "week" | "month" | "day" | null;

const EMPTY_PAY = /^(?:not\s+(?:listed|posted|stated|disclosed|specified|shown)|n\/?a|none|unknown|tbd|-+|doe|competitive)$/i;

/** One money amount: "$155,000", "$98.11", "$200K", "$1.2M". */
const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kKmM])?(?![a-zA-Z])/g;

/** Text that joins two amounts into a range. */
const RANGE_JOIN = /^\s*(?:\/\s*[a-z]+|(?:an?|per)\s+[a-z]+)?\s*(?:-|–|—|to|and)\s*$/i;

function periodOf(text: string): Period {
  const t = text.toLowerCase();
  if (/\b(?:an?|per|\/)\s*(?:hour|hr)\b|\bhourly\b|\/\s*h\b/.test(t)) return "hour";
  if (/\b(?:an?|per|\/)\s*(?:week|wk)\b|\bweekly\b/.test(t)) return "week";
  if (/\b(?:an?|per|\/)\s*(?:month|mo)\b|\bmonthly\b/.test(t)) return "month";
  if (/\b(?:an?|per|\/)\s*day\b|\bdaily\b/.test(t)) return "day";
  if (/\b(?:an?|per|\/)\s*(?:year|yr|annum)\b|\bannual(?:ly|ized)?\b|\byearly\b|\bsalary\b/.test(t))
    return "year";
  return null;
}

function amountOf(digits: string, suffix: string | undefined): number {
  const n = Number(digits.replace(/,/g, ""));
  if (!suffix) return n;
  return suffix.toLowerCase() === "k" ? n * 1_000 : n * 1_000_000;
}

function annualize(n: number, period: Period): number | null {
  switch (period) {
    case "hour":
      return Math.round(n * HOURS_PER_YEAR);
    case "week":
      return Math.round(n * 52);
    case "month":
      return Math.round(n * 12);
    case "year":
      return Math.round(n);
    case "day":
      // Working days per year vary by employer; do not guess.
      return null;
    default:
      // No period stated: accept only amounts that clearly read as annual pay.
      return n >= 10_000 ? Math.round(n) : null;
  }
}

/**
 * Parse posted pay text. Accepts a number (taken as annual pay) or a string.
 * Returns nulls for empty or placeholder text such as "Not listed".
 */
export function parseSalary(input: unknown): ParsedSalary {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return { salary_min: null, salary_max: null, salary_text: null };
    const annual = annualize(input, null);
    return { salary_min: annual, salary_max: annual, salary_text: String(input) };
  }
  if (typeof input !== "string") return { salary_min: null, salary_max: null, salary_text: null };

  const text = input.replace(/\s+/g, " ").trim();
  if (!text || EMPTY_PAY.test(text)) return { salary_min: null, salary_max: null, salary_text: null };

  // A bare number such as "150000" or "150,000".
  if (/^\d{1,3}(?:,\d{3})+$|^\d+$/.test(text)) {
    const annual = annualize(Number(text.replace(/,/g, "")), null);
    return { salary_min: annual, salary_max: annual, salary_text: text };
  }

  const matches = [...text.matchAll(MONEY)];
  if (matches.length === 0) return { salary_min: null, salary_max: null, salary_text: text };

  const first = matches[0];
  const firstAmount = amountOf(first[1], first[2]);
  let secondAmount: number | null = null;
  let rangeEnd = first.index! + first[0].length;

  const second = matches[1];
  if (second) {
    const between = text.slice(first.index! + first[0].length, second.index);
    if (RANGE_JOIN.test(between)) {
      secondAmount = amountOf(second[1], second[2]);
      rangeEnd = second.index! + second[0].length;
    }
  }

  // The period is read from the text right after the range, up to the next
  // amount or bracket, so "($204,000 a year)" notes do not change hourly pay.
  const nextMoney = matches.find((m) => m.index! >= rangeEnd);
  const stop = Math.min(
    nextMoney ? nextMoney.index! : text.length,
    ...["(", "["].map((c) => {
      const i = text.indexOf(c, rangeEnd);
      return i === -1 ? text.length : i;
    }),
  );
  const tail = text.slice(rangeEnd, stop);
  const head = text.slice(0, first.index);
  const between = text.slice(first.index! + first[0].length, rangeEnd);
  const period = periodOf(tail) ?? periodOf(between) ?? periodOf(head);

  const a = annualize(firstAmount, period);
  const b = secondAmount == null ? null : annualize(secondAmount, period);
  if (a == null) return { salary_min: null, salary_max: null, salary_text: text };

  if (b != null) {
    return { salary_min: Math.min(a, b), salary_max: Math.max(a, b), salary_text: text };
  }

  if (/\b(?:up\s+to|max(?:imum)?|as\s+much\s+as|not\s+to\s+exceed)\s*$/i.test(head)) {
    return { salary_min: null, salary_max: a, salary_text: text };
  }
  if (/\b(?:from|starting\s+(?:at|from)|min(?:imum)?|at\s+least)\s*$/i.test(head) || /^\s*\+/.test(text.slice(rangeEnd))) {
    return { salary_min: a, salary_max: null, salary_text: text };
  }
  return { salary_min: a, salary_max: a, salary_text: text };
}
