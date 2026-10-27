/**
 * The check for scheduled calls: `Authorization: Bearer ${CRON_SECRET}`.
 * Vercel Cron sends this header when CRON_SECRET is set in the project.
 */

import { timingSafeEqual } from "node:crypto";

export type CronAuth = { ok: true } | { ok: false; status: 401 | 503; message: string };

export function checkCronAuth(authorization: string | null | undefined, secret: string | undefined): CronAuth {
  if (!secret || !secret.trim()) {
    return { ok: false, status: 503, message: "CRON_SECRET is not set on the server." };
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }
  return { ok: true };
}
