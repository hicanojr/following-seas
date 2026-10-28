/**
 * Cached Claude extraction of the person's own resume.
 * Rendering copies strings that are already in the object. It does not add any.
 */

export type ParsedResume = Record<string, unknown>;

export function isParsedResume(value: unknown): value is ParsedResume {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

const MAX_RENDER = 4000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}

/** Plain text for the scoring prompt. Empty extractions say so, rather than inventing a resume. */
export function renderParsedResume(parsed: ParsedResume): string {
  const lines: string[] = [];
  const name = text(parsed.name);
  const headline = text(parsed.headline);
  const location = text(parsed.location);
  const who = [name, headline, location].filter(Boolean).join(" — ");
  if (who) lines.push(who);

  const credentials = list(parsed.credentials);
  if (credentials.length) lines.push("Credentials:", ...credentials.map((item) => `- ${item}`));
  const skills = list(parsed.skills);
  if (skills.length) lines.push("Skills:", ...skills.map((item) => `- ${item}`));

  if (Array.isArray(parsed.experience)) {
    const blocks: string[] = [];
    for (const item of parsed.experience) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const head = [text(record.title), text(record.organization), text(record.location), text(record.dates)]
        .filter(Boolean)
        .join(", ");
      const highlights = list(record.highlights).map((highlight) => `  - ${highlight}`);
      if (head || highlights.length) blocks.push([head, ...highlights].filter(Boolean).join("\n"));
    }
    if (blocks.length) lines.push("Experience:", ...blocks);
  }

  if (Array.isArray(parsed.education)) {
    const blocks: string[] = [];
    for (const item of parsed.education) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const head = [text(record.credential), text(record.institution), text(record.year)].filter(Boolean).join(", ");
      if (head) blocks.push(head);
    }
    if (blocks.length) lines.push("Education:", ...blocks);
  }

  const other = list(parsed.other);
  if (other.length) lines.push("Other:", ...other.map((item) => `- ${item}`));

  const rendered = lines.join("\n").trim();
  if (!rendered) return "(parsed resume was empty)";
  return rendered.length > MAX_RENDER ? `${rendered.slice(0, MAX_RENDER - 3)}...` : rendered;
}
