// Postgres error codes. Drizzle wraps the driver error, so the code can sit on
// the error or on its cause.
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  return codeOf(e.cause);
}

export function isUniqueViolation(error: unknown): boolean {
  return codeOf(error) === "23505";
}
