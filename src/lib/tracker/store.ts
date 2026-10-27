/**
 * Persistence for the Tracker. The service talks to this interface so it can
 * be tested without a database; `supabaseTrackerStore` is the real one.
 *
 * The Supabase client must be the per-request server client (anon key plus
 * the user's session), so Row Level Security limits every read and write to
 * the signed-in user. Never pass a service role client here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeKey } from "@/lib/dedupe";
import type { NormalizedJob } from "@/lib/jobs/types";
import type { ApplicationRow, ApplicationStatus, TrackedApplication } from "./types";

export interface NewApplication {
  job_id: string;
  status: ApplicationStatus;
  applied_on: string | null;
  follow_up_on: string | null;
  notes: string | null;
}

export type ApplicationPatch = Partial<Pick<ApplicationRow, "status" | "applied_on" | "follow_up_on" | "notes">>;

export interface TrackerStore {
  /** Job ids for these dedupe keys, soft-deleted jobs included (they keep their key). */
  jobIdsByDedupeKey(keys: string[]): Promise<Map<string, string>>;
  /** Whether a job with this id exists for the user. */
  jobExists(jobId: string): Promise<boolean>;
  /** Insert a job and return its id. If its dedupe key already exists, the existing id comes back. */
  insertJob(userId: string, job: NormalizedJob): Promise<{ id: string; created: boolean }>;
  /** Applications for these job ids, keyed by job id. */
  applicationsByJobId(jobIds: string[]): Promise<Map<string, ApplicationRow>>;
  getApplication(id: string): Promise<ApplicationRow | null>;
  insertApplication(userId: string, app: NewApplication): Promise<ApplicationRow>;
  updateApplication(id: string, patch: ApplicationPatch): Promise<ApplicationRow>;
  listApplications(): Promise<TrackedApplication[]>;
  audit(
    userId: string,
    action: string,
    entity: { table: "applications" | "jobs"; id: string | null },
    details: Record<string, unknown>,
  ): Promise<void>;
}

const APP_COLUMNS = "id, job_id, status, applied_on, follow_up_on, notes, created_at, updated_at";
const KEY_CHUNK = 100;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function supabaseTrackerStore(supabase: SupabaseClient): TrackerStore {
  async function jobIdsByDedupeKey(keys: string[]) {
    const found = new Map<string, string>();
    for (const part of chunks([...new Set(keys)], KEY_CHUNK)) {
      const { data, error } = await supabase.from("jobs").select("id, dedupe_key").in("dedupe_key", part);
      if (error) throw new Error(`Could not check for existing jobs: ${error.message}`);
      for (const row of (data ?? []) as { id: string; dedupe_key: string }[]) found.set(row.dedupe_key, row.id);
    }
    return found;
  }

  return {
    jobIdsByDedupeKey,

    async jobExists(jobId) {
      const { data, error } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
      if (error) throw new Error(`Could not load the job: ${error.message}`);
      return data != null;
    },

    async insertJob(userId, job) {
      const { data, error } = await supabase
        .from("jobs")
        .upsert({ ...job, user_id: userId }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
        .select("id, dedupe_key");
      if (error) throw new Error(`Could not save the job: ${error.message}`);
      const row = (data ?? [])[0] as { id: string } | undefined;
      if (row) return { id: row.id, created: true };
      // The key already exists (an earlier import, or a soft-deleted job); use that one.
      const existing = await jobIdsByDedupeKey([dedupeKey(job)]);
      const id = existing.get(dedupeKey(job));
      if (!id) throw new Error("Could not save the job.");
      return { id, created: false };
    },

    async applicationsByJobId(jobIds) {
      const found = new Map<string, ApplicationRow>();
      for (const part of chunks([...new Set(jobIds)], KEY_CHUNK)) {
        const { data, error } = await supabase.from("applications").select(APP_COLUMNS).in("job_id", part);
        if (error) throw new Error(`Could not load applications: ${error.message}`);
        for (const row of (data ?? []) as ApplicationRow[]) found.set(row.job_id, row);
      }
      return found;
    },

    async getApplication(id) {
      const { data, error } = await supabase.from("applications").select(APP_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`Could not load the application: ${error.message}`);
      return (data as ApplicationRow | null) ?? null;
    },

    async insertApplication(userId, app) {
      const { data, error } = await supabase
        .from("applications")
        .insert({ ...app, user_id: userId })
        .select(APP_COLUMNS)
        .single();
      if (error) throw new Error(`Could not save the application: ${error.message}`);
      return data as ApplicationRow;
    },

    async updateApplication(id, patch) {
      const { data, error } = await supabase
        .from("applications")
        .update(patch)
        .eq("id", id)
        .select(APP_COLUMNS)
        .single();
      if (error) throw new Error(`Could not update the application: ${error.message}`);
      return data as ApplicationRow;
    },

    async listApplications() {
      const { data, error } = await supabase
        .from("applications")
        .select(`${APP_COLUMNS}, job:jobs!inner(id, title, company, location, url, source)`)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(`Could not load applications: ${error.message}`);
      return (data ?? []) as unknown as TrackedApplication[];
    },

    async audit(userId, action, entity, details) {
      // A failed audit write is logged but does not undo the person's change.
      const { error } = await supabase.from("audit_log").insert({
        user_id: userId,
        actor: "tracker",
        action,
        entity_table: entity.table,
        entity_id: entity.id,
        details,
      });
      if (error) console.error("tracker audit write failed", error.message);
    },
  };
}
