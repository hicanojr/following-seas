import { NextResponse, type NextRequest } from "next/server";
import {
  importFile,
  importJson,
  importText,
  ImportFormatError,
  MAX_IMPORT_BYTES,
  type ImportOptions,
  type ParsedImport,
} from "@/lib/importers";
import { parseSource } from "@/lib/importers/fields";
import { importJobs, supabaseSearchStore } from "@/lib/search";
import { errorResponse, jsonError, requireUser } from "@/lib/search/route-helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/import
 *   multipart/form-data: file (.xlsx, .csv, .json) or text, plus optional source and profileId
 *   application/json:    { jobs: [...] } or { text: "..." }, plus optional source and profileId
 *
 * Saves the postings after the noise filter and dedupe. Returns counts with the
 * duplicates and dropped noise listed, so nothing is lost silently.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES + 64 * 1024) {
    return jsonError(413, "too_large", "That upload is larger than 5 MB.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  let parsed: ParsedImport;
  let profileId: string | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const options: ImportOptions = { defaultSource: parseSource(form.get("source")) ?? undefined };
      profileId = stringOrNull(form.get("profileId"));
      const file = form.get("file");
      const text = stringOrNull(form.get("text"));
      if (file instanceof File && file.size > 0) {
        parsed = await importFile(
          { name: file.name, type: file.type, bytes: await file.arrayBuffer() },
          options,
        );
      } else if (text) {
        parsed = importText(text, options);
      } else {
        return jsonError(400, "bad_input", "Choose a file or paste some rows to import.");
      }
    } else {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonError(400, "bad_input", "Send JSON or a multipart form.");
      }
      const options: ImportOptions = { defaultSource: parseSource(body?.source) ?? undefined };
      profileId = stringOrNull(body?.profileId);
      if (Array.isArray(body?.jobs)) parsed = importJson(body.jobs, options);
      else if (typeof body?.text === "string") parsed = importText(body.text, options);
      else return jsonError(400, "bad_input", "Send jobs (an array) or text.");
    }
  } catch (err) {
    if (err instanceof ImportFormatError) return jsonError(400, "bad_input", err.message);
    return errorResponse(err);
  }

  if (profileId && !UUID.test(profileId)) {
    return jsonError(400, "bad_input", "profileId must be a profile id.");
  }

  try {
    const summary = await importJobs(
      { userId: auth.user.id, jobs: parsed.jobs, profileId, skipped: parsed.skipped.length },
      { store: supabaseSearchStore(auth.supabase) },
    );
    return NextResponse.json({ ...summary, skipped: parsed.skipped });
  } catch (err) {
    return errorResponse(err);
  }
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
