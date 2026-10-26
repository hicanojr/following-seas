"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { STATUS_LABELS } from "@/lib/tracker/types";
import type { TrackerImportSummary } from "@/lib/tracker/service";

/** "Import tracker spreadsheet": bring in an existing .xlsx tracker with its statuses and dates. */
export function TrackerImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackerImportSummary | null>(null);
  const [, startTransition] = useTransition();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a tracker spreadsheet first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    try {
      const res = await fetch("/api/tracker-import", { method: "POST", body: form });
      const isJson = res.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await res.json() : null;
      if (res.redirected || !isJson) setError("Your session has ended. Sign in again to import.");
      else if (!res.ok) setError(data?.message ?? `Import failed (${res.status}).`);
      else {
        setResult(data as TrackerImportSummary);
        startTransition(() => router.refresh());
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <details className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold">Import tracker spreadsheet</summary>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <p className="text-xs text-muted">
          An .xlsx tracker (the sheet named Tracker is used when present) or a .csv with a Title column.
          Status, Date applied, Follow up, and Notes columns are read too. A status that is empty or not
          recognized becomes Saved, and dates are only taken from the sheet.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-full file:border file:border-line file:bg-background file:px-3 file:py-2 file:text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-accent dark:text-navy"
        >
          {busy ? "Importing..." : "Import"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
      {result && <ImportSummary result={result} />}
    </details>
  );
}

function ImportSummary({ result }: { result: TrackerImportSummary }) {
  return (
    <section role="status" aria-live="polite" className="mt-4 border-t border-line pt-4">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Created" value={result.created.length} />
        <Stat label="Attached to existing" value={result.attached.length} />
        <Stat label="Skipped" value={result.skipped.length} />
      </dl>
      <p className="mt-2 text-xs text-muted">{result.received} rows read.</p>
      <List
        title="Created"
        items={result.created.map((c) => ({ key: `c${c.row}`, text: label(c), note: STATUS_LABELS[c.status] }))}
      />
      <List
        title="Attached to existing jobs"
        items={result.attached.map((c) => ({ key: `a${c.row}`, text: label(c), note: STATUS_LABELS[c.status] }))}
      />
      <List
        title="Skipped"
        items={result.skipped.map((s) => ({
          key: `s${s.row}`,
          text: s.title ? `Row ${s.row}: ${s.title}` : `Row ${s.row}`,
          note: s.reason,
        }))}
      />
      <List
        title="Worth checking"
        items={result.warnings.map((w, i) => ({ key: `w${w.row}-${i}`, text: `Row ${w.row}: ${w.title}`, note: w.message }))}
      />
    </section>
  );
}

function label(c: { row: number; title: string; company: string | null }) {
  return `Row ${c.row}: ${[c.title, c.company].filter(Boolean).join(" · ")}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line px-2 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-serif text-2xl">{value}</dd>
    </div>
  );
}

function List({ title, items }: { title: string; items: { key: string; text: string; note: string }[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.key} className="rounded-lg bg-background px-3 py-2">
            <span className="block">{item.text}</span>
            <span className="block text-xs text-muted">{item.note}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
