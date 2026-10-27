import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordedCall {
  table: string;
  calls: [string, unknown[]][];
}

type Responder = (call: RecordedCall) => { data?: unknown; error?: { message: string } | null; count?: number | null };

/**
 * A stand-in Supabase client that records every chained call per `from()`.
 * Tests use it to check that each query filters by user_id.
 */
export function fakeSupabase(respond: Responder = () => ({ data: [] })) {
  const log: RecordedCall[] = [];
  const client = {
    from(table: string) {
      const rec: RecordedCall = { table, calls: [] };
      log.push(rec);
      const result = () => {
        const r = respond(rec);
        return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
      };
      const builder: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(result()).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              rec.calls.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

/** True when the recorded call chain has `.eq("user_id", userId)` or inserts rows with that user_id. */
export function scopedTo(rec: RecordedCall, userId: string): boolean {
  return rec.calls.some(([method, args]) => {
    if (method === "eq" && args[0] === "user_id" && args[1] === userId) return true;
    if (method === "insert" || method === "upsert") {
      const rows = Array.isArray(args[0]) ? args[0] : [args[0]];
      return rows.length > 0 && rows.every((r) => (r as { user_id?: string }).user_id === userId);
    }
    return false;
  });
}
