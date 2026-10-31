import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const sources = () => files(SRC).filter((f) => !f.includes("__tests__"));
const rel = (f: string) => relative(SRC, f).split("\\").join("/");

// A sign-in that installs a session from the URL lets an attacker swap a victim into
// the attacker's account: send the victim a link carrying the attacker's tokens.
describe("sign-in cannot install a session from a URL", () => {
  it("nothing calls setSession", () => {
    const hits = sources().filter((f) => /\.setSession\s*\(/.test(readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
  });

  it("there is no implicit-flow client or /auth/confirm page", () => {
    expect(existsSync(join(SRC, "app", "auth", "confirm"))).toBe(false);
    const hits = sources()
      .filter((f) => /flowType:\s*["']implicit["']|createEmailLinkClient/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("only the login form verifies a typed code, and no GET route signs in by token_hash", () => {
    const verifiers = sources()
      .filter((f) => /\.verifyOtp\s*\(/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(verifiers).toEqual(["app/login/LoginForm.tsx"]);
    const routes = sources().filter((f) => /token_hash/.test(readFileSync(f, "utf8"))).map(rel);
    expect(routes).toEqual([]);
  });
});
