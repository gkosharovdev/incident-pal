// CTEs (WITH ... SELECT) are rejected in v1 because the first token is WITH, not SELECT.
// See research.md Decision 3 for rationale and future extension path.
export function assertSelectOnly(query: string): void {
  const firstToken = query.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (firstToken !== "SELECT") {
    throw new Error(`WRITE_REJECTED: Only SELECT statements are permitted. Got: ${firstToken}`);
  }
}
