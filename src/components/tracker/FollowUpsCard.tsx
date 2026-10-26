"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatDate } from "@/lib/tracker/dates";
import { classifyFollowUps } from "@/lib/tracker/followups";
import type { TrackedApplication } from "@/lib/tracker/types";
import { callTracker } from "./api";
import { useToday } from "./useToday";

/**
 * Follow-ups due: overdue, due today, and the next 7 days. Reminders show in
 * the app only. "Done" means the person followed up themselves.
 */
export function FollowUpsCard({
  applications,
  showTrackerLink = false,
}: {
  applications: TrackedApplication[];
  showTrackerLink?: boolean;
}) {
  const today = useToday();
  const groups = useMemo(() => (today ? classifyFollowUps(applications, today) : null), [applications, today]);

  if (!groups) return null;
  const total = groups.overdue.length + groups.dueToday.length + groups.upcoming.length;

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="mb-3 h-px w-12 bg-brass" aria-hidden />
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Follow-ups due</h2>
        {showTrackerLink && (
          <Link href="/tracker" className="text-xs text-accent underline underline-offset-2">
            Tracker
          </Link>
        )}
      </div>
      {total === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Nothing due this week. When you mark a job applied, a follow-up reminder is set for 7 days later.
        </p>
      ) : (
        <div className="mt-2 space-y-4">
          <Group title="Overdue" tone="text-red-700 dark:text-red-300" items={groups.overdue} />
          <Group title="Due today" tone="text-brass" items={groups.dueToday} />
          <Group title="Next 7 days" tone="text-muted" items={groups.upcoming} />
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Reminders only. Fair Winds never emails or messages anyone for you.</p>
    </section>
  );
}

function Group({ title, tone, items }: { title: string; tone: string; items: TrackedApplication[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>
        {title} ({items.length})
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((app) => (
          <FollowUpItem key={app.id} app={app} />
        ))}
      </ul>
    </div>
  );
}

function FollowUpItem({ app }: { app: TrackedApplication }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  async function act(action: "snooze" | "done") {
    setBusy(true);
    setError(null);
    const result = await callTracker(`/api/applications/${app.id}`, "PATCH", { action });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else startTransition(() => router.refresh());
  }

  const working = busy || refreshing;
  return (
    <li className="rounded-xl bg-background px-3 py-2">
      <p className="text-sm font-medium leading-snug">{app.job.title}</p>
      <p className="text-xs text-muted">
        {[app.job.company, app.applied_on ? `applied ${formatDate(app.applied_on)}` : null, `follow up ${formatDate(app.follow_up_on)}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={working}
          onClick={() => act("snooze")}
          className="rounded-full border border-line px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          Snooze 3 days
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => act("done")}
          className="rounded-full border border-line px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          Done
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </li>
  );
}
