import { describe, expect, it, vi } from "vitest";
import * as gates from "@/lib/gates";
import { dedupeKey } from "@/lib/dedupe";
import type { NormalizedJob } from "@/lib/jobs/types";
import {
  addManualApplication,
  importTrackerRows,
  parseApplicationAction,
  TrackerError,
  updateApplication,
} from "../service";
import type { TrackerRow } from "../spreadsheet";
import type { NewApplication, TrackerStore } from "../store";
import type { ApplicationRow } from "../types";

const USER = "user-1";
const TODAY = "2026-10-26";

function memoryStore() {
  const jobs = new Map<string, { id: string; key: string; job: NormalizedJob }>();
  const apps = new Map<string, ApplicationRow>();
  const audits: { action: string; details: Record<string, unknown> }[] = [];
  let seq = 0;
  const store: TrackerStore = {
    async jobIdsByDedupeKey(keys) {
      const out = new Map<string, string>();
      for (const j of jobs.values()) if (keys.includes(j.key)) out.set(j.key, j.id);
      return out;
    },
    async jobExists(id) {
      return [...jobs.values()].some((j) => j.id === id);
    },
    async insertJob(_u, job) {
      const key = dedupeKey(job);
      const found = [...jobs.values()].find((j) => j.key === key);
      if (found) return { id: found.id, created: false };
      const id = `job-${++seq}`;
      jobs.set(id, { id, key, job });
      return { id, created: true };
    },
    async applicationsByJobId(ids) {
      const out = new Map<string, ApplicationRow>();
      for (const a of apps.values()) if (ids.includes(a.job_id)) out.set(a.job_id, a);
      return out;
    },
    async getApplication(id) {
      return apps.get(id) ?? null;
    },
    async insertApplication(_u, app: NewApplication) {
      const row: ApplicationRow = { id: `app-${++seq}`, ...app, created_at: "t", updated_at: "t" };
      apps.set(row.id, row);
      return row;
    },
    async updateApplication(id, patch) {
      const row = { ...apps.get(id)!, ...patch };
      apps.set(id, row);
      return row;
    },
    async listApplications() {
      return [];
    },
    async audit(_u, action, _e, details) {
      audits.push({ action, details });
    },
  };
  return { store, jobs, apps, audits };
}

const job = (title: string, company: string | null = "Acme"): NormalizedJob => ({
  source: "indeed",
  external_id: null,
  url: null,
  title,
  company,
  location: "Boston, MA",
  salary_min: null,
  salary_max: null,
  salary_text: null,
  description: null,
  requirements: [],
  easy_apply: "unknown",
  posted_at: null,
});

describe("addManualApplication", () => {
  it("creates a manual job and an applied application with a 7-day follow-up", async () => {
    const m = memoryStore();
    const spy = vi.spyOn(gates, "assertAllowed");
    const r = await addManualApplication(m.store, {
      userId: USER,
      today: TODAY,
      input: { title: "Lab Director", company: "Acme", url: "https://example.com/x" },
    });
    expect(spy).toHaveBeenCalledWith("track");
    expect(r.attachedToExisting).toBe(false);
    expect(r.application).toMatchObject({ status: "applied", applied_on: TODAY, follow_up_on: "2026-11-02" });
    expect([...m.jobs.values()][0].job).toMatchObject({ source: "manual", url: "https://example.com/x" });
    expect(m.audits[0].action).toBe("track.manual_add");
    spy.mockRestore();
  });

  it("attaches to an existing job with the same dedupe key", async () => {
    const m = memoryStore();
    await m.store.insertJob(USER, job("Lab Director"));
    const r = await addManualApplication(m.store, {
      userId: USER,
      today: TODAY,
      input: { title: "Lab Director", company: "Acme", location: "Boston, MA", applied_on: "2026-10-20" },
    });
    expect(r.attachedToExisting).toBe(true);
    expect(m.jobs.size).toBe(1);
    expect(r.application).toMatchObject({ applied_on: "2026-10-20", follow_up_on: "2026-10-27" });
  });

  it("refuses a missing title, a bad link, or a bad date", async () => {
    const m = memoryStore();
    const add = (input: Record<string, unknown>) => addManualApplication(m.store, { userId: USER, today: TODAY, input });
    await expect(add({})).rejects.toThrow(TrackerError);
    await expect(add({ title: "X", url: "javascript:alert(1)" })).rejects.toThrow(TrackerError);
    await expect(add({ title: "X", applied_on: "yesterday" })).rejects.toThrow(TrackerError);
  });
});

describe("updateApplication", () => {
  async function seeded() {
    const m = memoryStore();
    const { id } = await m.store.insertJob(USER, job("A"));
    const app = await m.store.insertApplication(USER, {
      job_id: id,
      status: "saved",
      applied_on: null,
      follow_up_on: "2026-10-20",
      notes: "Old note",
    });
    return { m, app };
  }

  it("move into Applied records today and a default follow-up", async () => {
    const { m, app } = await seeded();
    const r = await updateApplication(m.store, {
      userId: USER,
      id: app.id,
      today: TODAY,
      change: parseApplicationAction({ action: "move", status: "applied" }),
    });
    expect(r).toMatchObject({ status: "applied", applied_on: TODAY, follow_up_on: "2026-10-20" });
    expect(m.audits.at(-1)?.action).toBe("track.move");
  });

  it("snooze and done are reminders, gated by remind", async () => {
    const { m, app } = await seeded();
    const spy = vi.spyOn(gates, "assertAllowed");
    const snoozed = await updateApplication(m.store, { userId: USER, id: app.id, today: TODAY, change: { action: "snooze" } });
    expect(snoozed.follow_up_on).toBe("2026-10-29");
    const done = await updateApplication(m.store, { userId: USER, id: app.id, today: TODAY, change: { action: "done" } });
    expect(done).toMatchObject({ follow_up_on: null, notes: "Old note\n2026-10-26: Followed up." });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["remind", "remind"]);
    expect(m.audits.map((a) => a.action)).toEqual(["remind.snooze", "remind.done"]);
    spy.mockRestore();
  });

  it("404s an unknown application and rejects unknown actions", async () => {
    const { m } = await seeded();
    await expect(
      updateApplication(m.store, { userId: USER, id: "nope", today: TODAY, change: { action: "snooze" } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(() => parseApplicationAction({ action: "submit_application" })).toThrow(TrackerError);
    expect(() => parseApplicationAction({ action: "move", status: "hired" })).toThrow(TrackerError);
  });
});

describe("importTrackerRows", () => {
  const row = (n: number, j: NormalizedJob, over: Partial<TrackerRow> = {}): TrackerRow => ({
    row: n,
    job: j,
    status: "saved",
    applied_on: null,
    follow_up_on: null,
    notes: null,
    warnings: [],
    ...over,
  });

  it("counts created, attached, and skipped with reasons", async () => {
    const m = memoryStore();
    const { id: existingJob } = await m.store.insertJob(USER, job("Existing, untracked"));
    const { id: trackedJob } = await m.store.insertJob(USER, job("Already tracked"));
    await m.store.insertApplication(USER, { job_id: trackedJob, status: "interview", applied_on: null, follow_up_on: null, notes: null });

    const summary = await importTrackerRows(m.store, {
      userId: USER,
      rows: [
        row(2, job("New"), { status: "applied", applied_on: "2026-10-14", warnings: ["check me"] }),
        row(3, job("Existing, untracked")),
        row(4, job("Already tracked"), { status: "applied" }),
        row(5, job("New")),
      ],
      skipped: [{ row: 6, reason: "No title" }],
    });

    expect(summary.received).toBe(5);
    expect(summary.created.map((c) => c.row)).toEqual([2]);
    expect(summary.attached.map((c) => c.row)).toEqual([3]);
    expect(summary.skipped).toEqual([
      { row: 4, title: "Already tracked", reason: "Already on your tracker" },
      { row: 5, title: "New", reason: "Repeated in this file" },
      { row: 6, title: null, reason: "No title" },
    ]);
    expect(summary.warnings).toEqual([{ row: 2, title: "New", message: "check me" }]);
    const created = [...m.apps.values()].find((a) => a.status === "applied");
    expect(created).toMatchObject({ applied_on: "2026-10-14", follow_up_on: null }); // no invented follow-up
    expect([...m.apps.values()].find((a) => a.job_id === existingJob)?.status).toBe("saved");
    // The existing tracked application is untouched.
    expect([...m.apps.values()].find((a) => a.job_id === trackedJob)?.status).toBe("interview");
    expect(m.audits.at(-1)).toMatchObject({ action: "track.import", details: { created: 1, attached: 1, skipped: 3 } });
  });
});
