import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("service role boundary", () => {
  it("only the cron route imports the service role client", () => {
    const importers = files(SRC)
      .filter((f) => !f.includes("__tests__"))
      .filter((f) => /from\s+["']@\/lib\/brief\/admin["']|from\s+["']\.\/admin["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).split("\\").join("/"));
    expect(importers).toEqual(["app/api/cron/daily/route.ts"]);
  });

  it("only the admin module reads SUPABASE_SERVICE_ROLE_KEY", () => {
    const readers = files(SRC)
      .filter((f) => !f.includes("__tests__"))
      .filter((f) => readFileSync(f, "utf8").includes("process.env.SUPABASE_SERVICE_ROLE_KEY"))
      .map((f) => relative(SRC, f).split("\\").join("/"));
    expect(readers).toEqual(["lib/brief/admin.ts"]);
  });
});
