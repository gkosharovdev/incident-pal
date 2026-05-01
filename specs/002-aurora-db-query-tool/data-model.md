# Data Model: Aurora PostgreSQL DB Query Tool

**Branch**: `002-aurora-db-query-tool` | **Date**: 2026-05-01

---

## Entities

### AuroraDbInput (tool input schema)

The value the LLM passes when calling the tool. Validated against `INPUT_SCHEMA` (JSONSchema7).

| Field | Type | Required | Description |
|---|---|---|---|
| `serviceId` | `string` | Yes | Service identifier (must exist in service catalog) |
| `environment` | `"production" \| "staging" \| "canary"` | Yes | Target environment |
| `query` | `string` | Yes | SQL SELECT statement to execute |
| `maxRows` | `number` | No | Override default row cap (capped at constructor maximum) |

---

### AuroraDatabaseConfig (catalog entry per service/environment)

The connection details stored in `service-catalog.yml` under `auroraDatabase.<environment>`.

| Field | Type | Required | Description |
|---|---|---|---|
| `host` | `string` | Yes | Aurora cluster writer or reader endpoint hostname |
| `port` | `number` | Yes | PostgreSQL port (typically 5432) |
| `database` | `string` | Yes | Database name to connect to |
| `username` | `string` | Yes | Database username (must have `rds-db:connect` IAM permission when `credentialSource: iam`) |
| `region` | `string` | Yes | AWS region of the Aurora cluster (e.g., `eu-west-1`) |
| `credentialSource` | `"iam" \| "env-var"` | Yes | How to obtain the password |
| `envPasswordVar` | `string` | No | Name of the environment variable holding the password (only when `credentialSource: env-var`) |

---

### AuroraDbRow (single result row)

Returned as part of `AuroraDbResult.rows`. Each entry is a flat key-value map of column name → serialised value.

| Field | Type | Description |
|---|---|---|
| `[columnName: string]` | `string \| number \| boolean \| null` | Column value. Dates and complex types are serialised to their string representation. |

---

### AuroraDbResult (tool output, stored in `ToolResult.data`)

| Field | Type | Description |
|---|---|---|
| `rows` | `AuroraDbRow[]` | Result rows (at most `rowCap` entries) |
| `rowCount` | `number` | Number of rows returned (≤ `rowCap`) |
| `rowCap` | `number` | The maximum row count that was in effect for this query; always present so the agent can include it in the truncation warning (required by FR-005) |
| `truncated` | `boolean` | `true` if results were capped at `rowCap` |
| `queryExecutedMs` | `number` | Wall-clock time the query took to execute (milliseconds) |
| `serviceId` | `string` | Echo of the requested service ID (for traceability) |
| `environment` | `string` | Echo of the requested environment (for traceability) |

---

### ServiceEntry extension (service-catalog.yml)

The existing `ServiceEntry` interface in `ServiceCatalogTool.ts` is **not modified**. A new `AuroraDbCatalogReader` class reads the same YAML and adds the `auroraDatabase` field independently.

```typescript
// New, standalone interface — not added to src/models/
interface AuroraDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  region: string;
  credentialSource: "iam" | "env-var";
  envPasswordVar?: string;
}

interface AuroraServiceEntry {
  id: string;
  auroraDatabase?: Record<string, AuroraDatabaseConfig>; // keyed by environment
}
```

---

## State transitions

The tool has no persistent state. Each `invoke()` call is fully isolated:

```
invoke(input)
  → validate input (schema + SELECT guard)
    → [guard fails] return { success: false, error: "..." }
  → resolve catalog entry
    → [not found] return { success: false, error: "not configured" }
  → obtain credential (IAM token or env-var)
    → [credential error] return { success: false, error: "auth error" }
  → open pg.Client, SET statement_timeout
  → execute SELECT
    → [timeout / query error] close client, return { success: false, error: "..." }
  → collect rows (up to maxRows + 1 to detect truncation)
  → close client
  → return { success: true, data: AuroraDbResult, scanBytesUsed, truncated }
```

---

## Validation rules

| Rule | Enforcement point |
|---|---|
| `serviceId` must be non-empty string | JSONSchema `minLength: 1` |
| `environment` must be one of the three known values | JSONSchema `enum` |
| `query` must be non-empty string | JSONSchema `minLength: 1` |
| First token of `query` (trimmed, uppercased) must be `SELECT` | Runtime check before connection |
| `maxRows` (if provided) must be a positive integer ≤ constructor max | Runtime clamp |
| `auroraDatabase` entry must exist in catalog for the service/environment pair | Runtime check, returns structured error |
