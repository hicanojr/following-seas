"use client";

import { useSyncExternalStore } from "react";
import { localIsoDate } from "@/lib/tracker/dates";

function subscribe(onChange: () => void) {
  // Re-check when the page becomes visible again, for example the next morning.
  document.addEventListener("visibilitychange", onChange);
  const timer = window.setInterval(onChange, 60_000);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.clearInterval(timer);
  };
}

/**
 * The person's local date (YYYY-MM-DD), or null during server rendering, so
 * "due today" always follows the device's calendar rather than the server's.
 */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, () => localIsoDate(), () => null);
}
