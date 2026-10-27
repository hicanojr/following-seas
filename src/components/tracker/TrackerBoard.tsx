"use client";

import { useMemo, useState } from "react";
import { groupByStatus, runningList, runningListCsv } from "@/lib/tracker/board";
import { formatDate } from "@/lib/tracker/dates";
import { APPLICATION_STATUSES, STATUS_LABELS, type TrackedApplication } from "@/lib/tracker/types";
import { ApplicationCard } from "./ApplicationCard";
import { useToday } from "./useToday";

type View = "board" | "list";

/** The Tracker: a board grouped by status, and the running list of every job applied to. */
export function TrackerBoard({ applications }: { applications: TrackedApplication[] }) {
  const [view, setView] = useState<View>("board");
  const today = useToday();

  return (
    <section>
      <div role="tablist" aria-label="Tracker view" className="mb-4 grid grid-cols-2 rounded-full border border-line p-1 text-sm">
        {(["board", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-full px-3 py-2 font-medium ${
              view === v ? "bg-navy text-white dark:bg-accent dark:text-navy" : "text-muted"
            }`}
          >
            {v === "board" ? "Board" : "Running list"}
          </button>
        ))}
      </div>
      {view === "board" ? (
        <Board applications={applications} today={today} />
      ) : (
        <RunningList applications={applications} today={today} />
      )}
    </section>
  );
}

function Board({ applications, today }: { applications: TrackedApplication[]; today: string | null }) {
  const groups = useMemo(() => groupByStatus(applications), [applications]);
  return (
    <div className="space-y-4">
      {APPLICATION_STATUSES.map((status) => {
        const items = groups[status];
        return (
          <details key={status} open={items.length > 0 && status !== "closed"} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-1 py-2">
              <h2 className="font-serif text-xl">{STATUS_LABELS[status]}</h2>
              <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{items.length}</span>
            </summary>
            {items.length === 0 ? (
              <p className="px-1 pb-2 text-sm text-muted">Nothing here.</p>
            ) : (
              <div className="space-y-3">
                {items.map((app) => (
                  <ApplicationCard key={app.id} app={app} today={today} />
                ))}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

function RunningList({ applications, today }: { applications: TrackedApplication[]; today: string | null }) {
  const entries = useMemo(() => runningList(applications), [applications]);

  function download() {
    const blob = new Blob([runningListCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `applications-${today ?? "list"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">
        Jobs you mark as applied appear here, newest first, with the company, title, date, and link.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted">
          {entries.length} application{entries.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={download}
          className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-accent"
        >
          Download CSV
        </button>
      </div>
      <ol className="divide-y divide-line rounded-2xl border border-line bg-card">
        {entries.map((e, i) => (
          <li key={`${e.company}-${e.title}-${i}`} className="px-4 py-3">
            <p className="font-medium leading-snug">{e.title}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
              <span>{e.company || "Company not recorded"}</span>
              <span>{e.applied_on ? formatDate(e.applied_on) : "Date not recorded"}</span>
              {e.url && (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                  Link
                </a>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
