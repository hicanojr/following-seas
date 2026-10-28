/**
 * The Chief of Staff's tools. Each one is a thin wrapper over an existing
 * service. Every tool with a side effect names its gate action and calls
 * assertAllowed(action) before it touches any service.
 *
 * There is deliberately no tool that submits an application, uses Easy
 * Apply, sends email or messages, contacts a recruiter, logs in anywhere, or
 * writes a keep/skip decision. Tests enumerate this list to keep it that way.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { assertAllowed, type AllowedAction } from "@/lib/gates";
import { isJobSpySource, jobSpySourceLabel } from "@/lib/jobs/types";
import { isIsoDate } from "@/lib/tracker/dates";
import { buildDraft, DRAFT_KINDS, DRAFT_NOTICE } from "./drafts";
import { JOB_FILTERS, type ChiefDraft, type ChiefJob, type ChiefServices } from "./types";

export interface ToolContext {
  services: ChiefServices;
  userId: string;
  /** The person's local date, YYYY-MM-DD. */
  today: string;
  /** The person's message in this chat turn, exactly as sent. */
  personMessage: string;
  /** Job cards and drafts gathered for the UI during this turn. */
  collected: { jobs: ChiefJob[]; drafts: ChiefDraft[] };
}

/** A refusal or bad input the model should see as a tool error, in plain words. */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRefusal";
  }
}

export interface ChiefTool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** The gate action for a tool with side effects; null for read-only tools. */
  action: AllowedAction | null;
  definition: Anthropic.Beta.BetaTool;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

function tool<S extends z.ZodType>(t: ChiefTool<S>): ChiefTool<S> {
  return t;
}

const id = z.uuid();
const MAX_JOBS_SHOWN = 20;
const SHORTLIST_MIN_FIT = 7;
const SHORTLIST_SIZE = 5;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,!?]+|[\s"'.,!?]+$/g, "");
}

/** True when `quote` is the person's own words from `message` (case and spacing aside). */
export function isQuoteFromMessage(quote: string, message: string): boolean {
  const q = normalize(quote);
  return q.length >= 3 && normalize(message).includes(q);
}

function remember(ctx: ToolContext, jobs: ChiefJob[]) {
  const seen = new Set(ctx.collected.jobs.map((j) => j.id));
  for (const job of jobs) {
    if (!seen.has(job.id)) {
      ctx.collected.jobs.push(job);
      seen.add(job.id);
    }
  }
}

export const CHIEF_TOOLS = [
  tool({
    name: "list_profiles",
    action: null,
    definition: {
      name: "list_profiles",
      description:
        "List the person's active search profiles with target titles, locations, minimum base pay, must-haves, and deal-breakers. Read only.",
      input_schema: { type: "object", properties: {} },
    },
    schema: z.object({}),
    async run(_input, ctx) {
      return { profiles: await ctx.services.listProfiles() };
    },
  }),

  tool({
    name: "list_queries",
    action: null,
    definition: {
      name: "list_queries",
      description:
        "List the saved search queries for one profile: source, query text, quality (good, mixed, noise, untested), whether retired, and how often it ran. Read only. Indeed and ZipRecruiter queries are import only and cannot be run.",
      input_schema: {
        type: "object",
        properties: { profile_id: { type: "string", description: "The profile id from list_profiles." } },
        required: ["profile_id"],
      },
    },
    schema: z.object({ profile_id: id }),
    async run(input, ctx) {
      return { queries: await ctx.services.listQueries(input.profile_id) };
    },
  }),

  tool({
    name: "run_search",
    action: "search",
    definition: {
      name: "run_search",
      description:
        "Run one saved LinkedIn or USAJobs query and save new postings (deduplicated, noise filtered). LinkedIn runs return 25 to 50 results through the approved data source. Refuses retired queries. Indeed, ZipRecruiter, Glassdoor, and Google are run by the JobSpy worker, not here.",
      input_schema: {
        type: "object",
        properties: { query_id: { type: "string", description: "The query id from list_queries." } },
        required: ["query_id"],
      },
    },
    schema: z.object({ query_id: id }),
    async run(input, ctx) {
      assertAllowed("search");
      const query = await ctx.services.getQuery(input.query_id);
      if (!query) throw new ToolRefusal("That query was not found.");
      if (query.retired) {
        throw new ToolRefusal(
          "This query is retired (marked noise or switched off), so it is not run. The person can un-retire it on the Profiles tab.",
        );
      }
      if (isJobSpySource(query.source)) {
        throw new ToolRefusal(
          `${jobSpySourceLabel(query.source)} is not searched from here. The JobSpy worker runs it. You can also import a file on the Jobs tab.`,
        );
      }
      const summary = await ctx.services.runSearch(query.id);
      return { query: query.query_text, ...summary };
    },
  }),

  tool({
    name: "score_jobs",
    action: "score",
    definition: {
      name: "score_jobs",
      description:
        "Score jobs 1 to 10 against a profile using only the person's career facts. With no job_ids, scores the profile's not-yet-scored jobs (up to 50).",
      input_schema: {
        type: "object",
        properties: {
          profile_id: { type: "string" },
          job_ids: { type: "array", items: { type: "string" }, description: "Optional. Specific jobs to score." },
        },
        required: ["profile_id"],
      },
    },
    schema: z.object({ profile_id: id, job_ids: z.array(id).max(50).optional() }),
    async run(input, ctx) {
      assertAllowed("score");
      return ctx.services.scoreJobs(input.profile_id, input.job_ids);
    },
  }),

  tool({
    name: "list_jobs",
    action: null,
    definition: {
      name: "list_jobs",
      description:
        "List scored jobs for a profile, best fit first. filter: to_review (no decision yet), kept, skipped, or screened_out (hit a deal-breaker). Returns title, company, location, salary, fit, reason, gaps, unmet must-haves, Easy Apply status, and link. Read only.",
      input_schema: {
        type: "object",
        properties: {
          profile_id: { type: "string" },
          filter: { type: "string", enum: [...JOB_FILTERS] },
          min_fit: { type: "integer", minimum: 1, maximum: 10, description: "Optional. Only jobs at or above this fit." },
        },
        required: ["profile_id", "filter"],
      },
    },
    schema: z.object({
      profile_id: id,
      filter: z.enum(JOB_FILTERS),
      min_fit: z.number().int().min(1).max(10).optional(),
    }),
    async run(input, ctx) {
      const all = await ctx.services.listJobs(input.profile_id, input.filter, input.min_fit);
      const jobs = all.slice(0, MAX_JOBS_SHOWN);
      remember(ctx, jobs);
      return { total: all.length, shown: jobs.length, jobs };
    },
  }),

  tool({
    name: "suggest_shortlist",
    action: "shortlist_suggest",
    definition: {
      name: "suggest_shortlist",
      description:
        "Suggest up to 5 jobs worth a look: undecided, no deal-breaker, fit 7 or higher. Suggestions only. It never records Keep or Skip; those are the person's own taps on the Jobs tab.",
      input_schema: {
        type: "object",
        properties: { profile_id: { type: "string" } },
        required: ["profile_id"],
      },
    },
    schema: z.object({ profile_id: id }),
    async run(input, ctx) {
      assertAllowed("shortlist_suggest");
      const candidates = await ctx.services.listJobs(input.profile_id, "to_review", SHORTLIST_MIN_FIT);
      const suggestions = candidates.filter((j) => !j.deal_breaker).slice(0, SHORTLIST_SIZE);
      remember(ctx, suggestions);
      return {
        suggestions,
        note: "Suggestions only. Nothing was kept or skipped. The person decides with Keep or Skip on the Jobs tab.",
      };
    },
  }),

  tool({
    name: "tracker_summary",
    action: null,
    definition: {
      name: "tracker_summary",
      description:
        "Summarize the person's tracker: how many applications are saved, applied, interview, offer, closed, and the most recent applications. Read only.",
      input_schema: { type: "object", properties: {} },
    },
    schema: z.object({}),
    async run(_input, ctx) {
      return ctx.services.trackerSummary();
    },
  }),

  tool({
    name: "follow_ups",
    action: null,
    definition: {
      name: "follow_ups",
      description:
        "Follow-ups the person should make: overdue, due today, and upcoming in the next 7 days. Read only; reminders are shown in the app and never sent.",
      input_schema: { type: "object", properties: {} },
    },
    schema: z.object({}),
    async run(_input, ctx) {
      return ctx.services.followUps(ctx.today);
    },
  }),

  tool({
    name: "mark_applied",
    action: "track",
    definition: {
      name: "mark_applied",
      description:
        "Record that the person applied to a job THEMSELVES. Use only when the person's latest message says they applied. person_said must quote their exact words from that message. Adds the job to the running list with company, title, date, and link, and sets a follow-up 7 days later. This does not apply to anything.",
      input_schema: {
        type: "object",
        properties: {
          job_id: { type: "string" },
          person_said: {
            type: "string",
            description: "The person's exact words from their latest message saying they applied.",
          },
          date: { type: "string", description: "Optional. Date applied, YYYY-MM-DD. Defaults to today." },
        },
        required: ["job_id", "person_said"],
      },
    },
    schema: z.object({ job_id: id, person_said: z.string(), date: z.string().optional() }),
    async run(input, ctx) {
      assertAllowed("track");
      const said = input.person_said.trim();
      if (!said) {
        throw new ToolRefusal(
          "Refused: person_said is empty. Record an application only when the person says in this message that they applied.",
        );
      }
      if (!isQuoteFromMessage(said, ctx.personMessage)) {
        throw new ToolRefusal(
          "Refused: person_said is not the person's words from this message. Record an application only when the person says they applied.",
        );
      }
      const date = input.date?.trim() || ctx.today;
      if (!isIsoDate(date)) throw new ToolRefusal("date must be YYYY-MM-DD.");
      if (date > ctx.today) throw new ToolRefusal("The date applied cannot be in the future.");
      const entry = await ctx.services.markApplied(input.job_id, date, ctx.today);
      return { recorded: true, ...entry, note: "Recorded on the tracker. Nothing was submitted or sent." };
    },
  }),

  tool({
    name: "draft_note",
    action: "draft",
    definition: {
      name: "draft_note",
      description:
        "Write a draft follow-up email or thank-you note about one job for the person to review and send themselves. Returns text only; it is never sent.",
      input_schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...DRAFT_KINDS] },
          job_id: { type: "string" },
        },
        required: ["kind", "job_id"],
      },
    },
    schema: z.object({ kind: z.enum(DRAFT_KINDS), job_id: id }),
    async run(input, ctx) {
      assertAllowed("draft");
      const job = await ctx.services.getJobForDraft(input.job_id);
      if (!job) throw new ToolRefusal("That job was not found.");
      const draft = buildDraft(input.kind, job);
      ctx.collected.drafts.push(draft);
      return { label: draft.label, sent: false, notice: DRAFT_NOTICE, text: draft.text };
    },
  }),
] as const satisfies readonly ChiefTool[];

export type ChiefToolName = (typeof CHIEF_TOOLS)[number]["name"];

const byName = new Map<string, ChiefTool>(CHIEF_TOOLS.map((t) => [t.name, t as unknown as ChiefTool]));

export function findTool(name: string): ChiefTool | undefined {
  return byName.get(name);
}

/** Tool definitions for the API request, in a fixed order (keeps the cache prefix stable). */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return CHIEF_TOOLS.map((t) => t.definition);
}
