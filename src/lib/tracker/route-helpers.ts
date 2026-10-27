import "server-only";

import { GateError } from "@/lib/gates";
import { ImportFormatError } from "@/lib/importers";
import { jsonError } from "@/lib/search/route-helpers";
import { TrackerError } from "./service";

export { jsonError, requireUser } from "@/lib/search/route-helpers";

/** Known errors become clear responses; anything else is a 500 without internals. */
export function trackerErrorResponse(err: unknown) {
  if (err instanceof TrackerError) return jsonError(err.status, err.code, err.message);
  if (err instanceof ImportFormatError) return jsonError(400, "bad_input", err.message);
  if (err instanceof GateError) return jsonError(403, "gate", err.message);
  console.error("tracker route error", err);
  return jsonError(500, "server_error", "Something went wrong. Try again.");
}

/** Read a JSON body, or null when it is not JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
