"use client";

import { useState, type FormEvent } from "react";

type Listed = { title: string; company: string | null; location: string | null; reason: string };

interface ImportResult {
  received: number;
  imported: number;
  duplicates: Listed[];
  noise: Listed[];
  skipped: { row: number; reason: string }[];
}

type Status = "idle" | "working" | "done" | "error";

const SOURCES = [
  { value: "indeed", label: "Indeed" },
  { value: "ziprecruiter", label: "ZipRecruiter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "usajobs", label: "USAJobs" },
  { value: "manual", label: "Other or mixed" },
];

const DUPLICATE_REASON: Record<string, string> = {
  already_saved: "Already saved",
  duplicate_in_batch: "Repeated in this import",
};

function describe(item: Listed) {
  return [item.title, item.company, item.location].filter(Boolean).join(" · ");
}

export function ImportForm() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("indeed");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file && !text.trim()) {
      setStatus("error");
      setMessage("Choose a file or paste some rows first.");
      return;
    }
    setStatus("working");
    setMessage(null);
    setResult(null);
    const form = new FormData();
    form.set("source", source);
    if (file) form.set("file", file);
    else form.set("text", text);
    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setMessage(data?.message ?? `Import failed (${res.status}).`);
        return;
      }
      setResult(data as ImportResult);
      setStatus("done");
    } catch {
      setStatus("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div>
          <label htmlFor="source" className="block text-sm font-medium">
            Where these came from
          </label>
          <select
            id="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-3 text-base outline-none focus:border-accent"
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Used when a row does not name its own source.</p>
        </div>

        <div>
          <label htmlFor="file" className="block text-sm font-medium">
            File
          </label>
          <input
            id="file"
            type="file"
            accept=".xlsx,.csv,.tsv,.json,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-sm file:mr-3 file:rounded-full file:border file:border-line file:bg-background file:px-3 file:py-2 file:text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            .xlsx (a sheet named Tracker is used when present), .csv, or .json. Up to 5 MB.
          </p>
        </div>

        <div>
          <label htmlFor="paste" className="block text-sm font-medium">
            Or paste rows
          </label>
          <textarea
            id="paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={file !== null}
            rows={6}
            placeholder={"Title,Company,Location,Salary,Link\nDirector of Laboratory Services,Example Health,\"Boston, MA\",\"$155,000 - $185,000 a year\",https://…"}
            className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-3 font-mono text-sm outline-none focus:border-accent disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-muted">
            CSV with a header row, cells copied from a spreadsheet, or a JSON array.
          </p>
        </div>

        <button
          type="submit"
          disabled={status === "working"}
          className="w-full rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-accent dark:text-navy"
        >
          {status === "working" ? "Importing…" : "Import"}
        </button>

        {message && (
          <p role="status" className="text-sm text-red-700 dark:text-red-300">
            {message}
          </p>
        )}
      </form>

      {result && <ImportSummary result={result} />}
    </>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm"
    >
      <div className="mb-4 h-px w-12 bg-brass" aria-hidden />
      <h2 className="text-lg font-semibold">Import finished</h2>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Stat label="Imported" value={result.imported} />
        <Stat label="Duplicates skipped" value={result.duplicates.length} />
        <Stat label="Noise dropped" value={result.noise.length} />
      </dl>
      <p className="mt-3 text-xs text-muted">{result.received} rows read.</p>

      <Details title="Noise dropped" items={result.noise.map((n) => ({ key: describe(n), text: describe(n), reason: n.reason }))} />
      <Details
        title="Duplicates skipped"
        items={result.duplicates.map((d) => ({
          key: describe(d),
          text: describe(d),
          reason: DUPLICATE_REASON[d.reason] ?? d.reason,
        }))}
      />
      <Details
        title="Rows not read"
        items={result.skipped.map((s) => ({ key: `row-${s.row}`, text: `Row ${s.row}`, reason: s.reason }))}
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line px-2 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-serif text-2xl">{value}</dd>
    </div>
  );
}

function Details({ title, items }: { title: string; items: { key: string; text: string; reason: string }[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={`${item.key}-${i}`} className="rounded-lg bg-background px-3 py-2">
            <span className="block">{item.text}</span>
            <span className="block text-xs text-muted">{item.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
