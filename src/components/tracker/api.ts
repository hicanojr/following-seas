"use client";

import { localIsoDate } from "@/lib/tracker/dates";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Call a tracker route with the person's local date attached. */
export async function callTracker<T = unknown>(
  url: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, today: localIsoDate() }),
    });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (res.redirected || !isJson) {
      return { ok: false, message: "Your session has ended. Sign in again to continue." };
    }
    const data = (await res.json()) as T & { message?: string };
    if (!res.ok) return { ok: false, message: data.message ?? `That did not work (${res.status}).` };
    return { ok: true, data };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}
