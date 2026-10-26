/**
 * Errors the Search agent raises on purpose. Each carries the HTTP status an
 * API route should return, so routes can map them without guessing.
 */

export class SearchError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SearchError";
    this.code = code;
    this.status = status;
  }
}

/** A needed env var (API token or key) is not set. */
export class MissingConfigError extends SearchError {
  readonly envVar: string;

  constructor(envVar: string, what: string) {
    super("missing_config", `${what} is not configured. Set ${envVar} on the server.`, 503);
    this.envVar = envVar;
  }
}

/** Indeed and ZipRecruiter searches run elsewhere; their results are imported. */
export class ImportOnlyError extends SearchError {
  constructor(source: string) {
    super(
      "import_only",
      `${source} is import only. Run the search in Claude and import the results on the Import jobs page.`,
      400,
    );
  }
}

export class NotFoundError extends SearchError {
  constructor(what: string) {
    super("not_found", `${what} was not found.`, 404);
  }
}

export class RetiredQueryError extends SearchError {
  constructor() {
    super("retired", "This query is retired. Un-retire it before running it again.", 409);
  }
}

/** The search provider answered with an error. */
export class UpstreamError extends SearchError {
  constructor(provider: string, detail: string) {
    super("upstream", `${provider} search failed: ${detail}`, 502);
  }
}
