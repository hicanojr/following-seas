import { NextResponse, type NextRequest } from "next/server";
import { MAX_IMPORT_BYTES } from "@/lib/importers";
import { parseSource } from "@/lib/importers/fields";
import { importTrackerRows, parseTrackerFile, supabaseTrackerStore } from "@/lib/tracker";
import { jsonError, requireUser, trackerErrorResponse } from "@/lib/tracker/route-helpers";

/**
 * POST /api/tracker-import (multipart/form-data: file, optional source and sheet)
 *
 * Reads an existing tracker spreadsheet, saves each posting (deduplicated) and
 * records an application with the sheet's status and dates. Returns how many
 * were created, attached to jobs already in the app, and skipped with reasons.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES + 64 * 1024) {
    return jsonError(413, "too_large", "That upload is larger than 5 MB.");
  }
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return jsonError(400, "bad_input", "Upload the tracker as a file.");
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError(400, "bad_input", "Choose a tracker spreadsheet to import.");
    }
    const sheet = form.get("sheet");
    const parsed = await parseTrackerFile(
      { name: file.name, type: file.type, bytes: await file.arrayBuffer() },
      {
        defaultSource: parseSource(form.get("source")) ?? undefined,
        sheet: typeof sheet === "string" && sheet.trim() ? sheet.trim() : undefined,
      },
    );
    const summary = await importTrackerRows(supabaseTrackerStore(auth.supabase), {
      userId: auth.user.id,
      rows: parsed.rows,
      skipped: parsed.skipped,
      fileName: file.name,
    });
    return NextResponse.json(summary);
  } catch (err) {
    return trackerErrorResponse(err);
  }
}
