import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoringClient } from "../model";
import { mapWithConcurrency, scoreJobs } from "../service";
import { MLT_FACTS, makeJob, makeProfile } from "./fixtures";

type Call = { table: string; op: string; payload?: unknown; filters: [string, ...unknown[]][]; opts?: unknown };

/** Minimal chainable fake of the Supabase query builder. */
function fakeSupabase(tables: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const result = () => {
        if (call.op === "insert" && table === "agent_runs") return { data: { id: "run-1" }, error: null };
        if (call.op !== "select") return { data: null, error: null };
        return { data: tables[table] ?? [], error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), builder),
        update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), builder),
        upsert: (payload: unknown, opts: unknown) => ((call.op = "upsert"), (call.payload = payload), (call.opts = opts), builder),
        maybeSingle: async () => {
          const r = result();
          return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
        },
        single: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      for (const m of ["eq", "is", "in", "not", "order", "limit"]) {
        builder[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), builder);
      }
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient, calls };
}

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once and keeps order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("scoreJobs", () => {
  it("scores, screens deal-breakers without a model call, upserts, and logs the run", async () => {
    const profile = makeProfile({ deal_breakers: ["contract"], must_haves: ["Hospital"] });
    const good = makeJob({ id: "job-good", description: "Hospital lab leadership." });
    const bad = makeJob({ id: "job-bad", title: "Lab Manager (Contract)" });
    const { supabase, calls } = fakeSupabase({
      profiles: [{ ...profile, deleted_at: null }],
      career_facts: [MLT_FACTS],
      scores: [],
      jobs: [good, bad],
    });
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({ fit: 7, reason: "Good match.", requirements_met: [], gaps: [], must_haves_met: [] }),
        },
      ],
    });
    const client = { messages: { create } } as unknown as ScoringClient;

    const outcome = await scoreJobs({ userId: profile.user_id, profileId: profile.id }, { supabase, client, model: "m" });

    expect(outcome).toEqual({ runId: "run-1", scored: 2, screenedOut: 1, prefiltered: 0, awaitingEmbedding: 0, failed: [] });
    expect(create).toHaveBeenCalledTimes(1);

    const upserts = calls.filter((c) => c.table === "scores" && c.op === "upsert");
    expect(upserts).toHaveLength(2);
    expect(upserts[0].opts).toEqual({ onConflict: "job_id,profile_id" });
    const screened = upserts.map((u) => u.payload as Record<string, unknown>).find((p) => p.job_id === "job-bad");
    expect(screened?.deal_breaker_hit).toBe("contract");

    const runInsert = calls.find((c) => c.table === "agent_runs" && c.op === "insert");
    expect((runInsert?.payload as Record<string, unknown>).agent).toBe("scoring");
    const runUpdate = calls.find((c) => c.table === "agent_runs" && c.op === "update");
    expect((runUpdate?.payload as Record<string, unknown>).status).toBe("succeeded");
    expect(calls.some((c) => c.table === "audit_log" && c.op === "insert")).toBe(true);
  });

  it("records per-job failures without stopping the batch", async () => {
    const profile = makeProfile();
    const { supabase, calls } = fakeSupabase({
      profiles: [profile],
      career_facts: [],
      scores: [],
      jobs: [makeJob({ id: "a" }), makeJob({ id: "b" })],
    });
    const create = vi.fn().mockRejectedValue(new Error("rate limited"));
    const outcome = await scoreJobs(
      { userId: profile.user_id, profileId: profile.id },
      { supabase, client: { messages: { create } } as unknown as ScoringClient },
    );
    expect(outcome.scored).toBe(0);
    expect(outcome.failed.map((f) => f.jobId).sort()).toEqual(["a", "b"]);
    const runUpdate = calls.find((c) => c.table === "agent_runs" && c.op === "update");
    expect((runUpdate?.payload as Record<string, unknown>).status).toBe("failed");
  });

  it("returns 404 for a missing profile", async () => {
    const { supabase } = fakeSupabase({ profiles: [] });
    await expect(
      scoreJobs({ userId: "u", profileId: "p" }, { supabase, client: {} as ScoringClient }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("sends only the top quarter by resume similarity, and reuses the cached parse", async () => {
    const profile = makeProfile();
    const jobs = ["best", "mid", "low", "old"].map((id, index) =>
      makeJob({ id, title: `Role ${id}`, description: `Posting ${index}` }),
    );
    const { supabase } = fakeSupabase({
      profiles: [profile],
      career_facts: [],
      resumes: [{ parsed: { skills: ["HPLC"] }, embedded_at: "2026-10-01T00:00:00Z" }],
      job_resume_similarity: [
        { job_id: "best", similarity: 0.91 },
        { job_id: "mid", similarity: 0.4 },
        { job_id: "low", similarity: 0.2 },
        { job_id: "old", similarity: 0.05 },
      ],
      scores: [],
      jobs,
    });
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ fit: 6, reason: "Close enough.", requirements_met: [], gaps: [], must_haves_met: [] }) }],
    });
    const outcome = await scoreJobs(
      { userId: profile.user_id, profileId: profile.id },
      { supabase, client: { messages: { create } } as unknown as ScoringClient },
    );
    expect(outcome.scored).toBe(1);
    expect(outcome.prefiltered).toBe(3);
    expect(outcome.awaitingEmbedding).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
    expect(prompt).toContain("HPLC");
    expect(prompt).toContain("Role best");
  });
});
