import { describe, expect, it } from "vitest";
import { userScopedSearchStore } from "../scoped-search-store";
import { fakeSupabase, scopedTo } from "./fake-supabase";
import { job } from "@/lib/search/__tests__/helpers";

const USER = "11111111-1111-1111-1111-111111111111";

describe("userScopedSearchStore (service role adapter)", () => {
  it("filters every read and update by the user id, and stamps it on every insert", async () => {
    const { client, log } = fakeSupabase((rec) =>
      rec.calls.some(([m]) => m === "single") ? { data: { id: "run-1" } } : { data: [] },
    );
    const store = userScopedSearchStore(client, USER);

    await store.getQuery("q1");
    await store.getProfile("p1");
    await store.existingDedupeKeys(["a|b|c"]);
    await store.insertJobs(USER, [job()]);
    await store.updateQueryStats("q1", { runs: 1, total_hits: 3, last_run_at: "2026-10-26T11:00:00Z" });
    const runId = await store.startRun(USER, "search", { kind: "search" });
    await store.finishRun(runId, "succeeded", {});
    await store.audit(USER, "search", {});

    expect(log.map((r) => r.table)).toEqual([
      "queries",
      "profiles",
      "jobs",
      "jobs",
      "queries",
      "agent_runs",
      "agent_runs",
      "audit_log",
    ]);
    for (const rec of log) expect(scopedTo(rec, USER), `${rec.table} ${JSON.stringify(rec.calls)}`).toBe(true);
  });

  it("refuses to write for anyone else", async () => {
    const { client } = fakeSupabase();
    const store = userScopedSearchStore(client, USER);
    await expect(store.insertJobs("someone-else", [job()])).rejects.toThrow(/own user/);
    await expect(store.startRun("someone-else", "search", {})).rejects.toThrow(/own user/);
    await expect(store.audit("someone-else", "search", {})).rejects.toThrow(/own user/);
  });

  it("needs a user id", () => {
    expect(() => userScopedSearchStore(fakeSupabase().client, "")).toThrow();
  });
});
