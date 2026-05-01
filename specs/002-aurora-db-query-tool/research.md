# Research: Aurora PostgreSQL DB Query Tool

**Branch**: `002-aurora-db-query-tool` | **Date**: 2026-05-01

---

## Decision 1: PostgreSQL client library

**Decision**: `pg` (node-postgres) v8.x  
**Rationale**: The de-facto standard Node.js PostgreSQL client. Supports SSL (required for Aurora), async/await, parameterised queries, and `statement_timeout` enforcement. No ORM is needed — the agent issues raw SQL SELECT statements.  
**Alternatives considered**:
- `postgres` (porsager) — leaner API but less ecosystem maturity and fewer Aurora-specific examples
- `kysely` — query builder adds unnecessary abstraction; the LLM generates raw SQL
- `prisma` — ORM overhead is inappropriate for a read-only query tool; schema introspection at startup is too heavyweight

**New dependency**: `pg` + `@types/pg`  
**New AWS SDK dependency**: `@aws-sdk/rds-signer` (already in the AWS SDK v3 family used by CloudWatchLogsTool and EcsDeploymentTool — adds one new package, not a new SDK major version)

---

## Decision 2: Authentication to Aurora

**Decision**: IAM database authentication via `@aws-sdk/rds-signer`  
**Rationale**: Aurora PostgreSQL supports IAM auth natively. The `RDSSigner.getAuthToken()` call generates a short-lived (15-minute) password token using the process's AWS credential chain (IAM role, environment variables, or instance profile). This avoids storing long-lived database passwords and is consistent with how `CloudWatchLogsTool` and `EcsDeploymentTool` authenticate — both rely on the ambient AWS credential chain with no explicit credential management in the tool.  
**How it works**: The tool calls `RDSSigner.getAuthToken({ hostname, port, region, username })`, then passes the returned token as the `password` field to `pg.Client`, with SSL mode `require`. The Aurora cluster must have IAM authentication enabled and the connecting IAM role must have the `rds-db:connect` permission.  
**Alternatives considered**:
- Password from environment variable / AWS Secrets Manager — valid fallback for clusters without IAM auth enabled; supported as a `credentialSource: env-var` option in the catalog entry
- `pg-iam` package — thin wrapper around the same approach; adds a transitive dependency with no benefit

---

## Decision 3: SQL injection / write-operation guard

**Decision**: First-token normalisation check — reject any query whose first non-whitespace token (uppercased) is not `SELECT`  
**Rationale**: The guard needs to be deterministic and have cyclomatic complexity ≤ 10 (constitution §III). A full SQL parser (e.g., `node-sql-parser`) would correctly handle edge cases like CTEs (`WITH ... SELECT`) but adds a dependency and raises complexity. Since the agent (LLM) generates the queries and is instructed to issue SELECT-only statements, a first-token check is sufficient. Edge cases like `WITH ... SELECT` are excluded in v1 and documented — if needed they can be added as an allowed prefix list in a future iteration.  
**Implementation**: `const firstToken = query.trim().split(/\s+/)[0]?.toUpperCase(); if (firstToken !== 'SELECT') return error result;`  
**Alternatives considered**:
- `node-sql-parser` — correct but adds ~1MB dependency and ≥ 5 complexity points in the parse path
- Regex on disallowed keywords — fragile; can be bypassed by comments or unusual whitespace

---

## Decision 4: Service catalog extension for database connection details

**Decision**: Add an optional `auroraDatabase` map to `ServiceEntry` in `service-catalog.yml`, keyed by environment  
**Rationale**: The existing catalog already maps `logGroups` per environment; the same pattern is natural for database connection details. The `ServiceCatalogTool` is not modified — a new `AuroraDbCatalogReader` (a plain class, not a `Tool`) reads the same YAML file and returns the database config for a given service/environment pair. This avoids modifying any file under `src/agent/` or `src/models/` and respects the Open/Closed boundary.  
**Schema extension (per service entry)**:
```yaml
auroraDatabase:
  production:
    host: order-service.cluster-xxx.eu-west-1.rds.amazonaws.com
    port: 5432
    database: order_service_prod
    username: iam_investigation_user
    region: eu-west-1
    credentialSource: iam   # "iam" | "env-var"
    envPasswordVar: ""      # only used when credentialSource: env-var
  staging:
    host: order-service-staging.cluster-yyy.eu-west-1.rds.amazonaws.com
    port: 5432
    database: order_service_staging
    username: iam_investigation_user
    region: eu-west-1
    credentialSource: iam
```
**Alternatives considered**:
- Separate `db-catalog.yml` — adds operational burden (two files to maintain per service); the single-file pattern is already established
- Hardcoded connection strings — violates the environment-scoped targeting requirement (spec FR-003)

---

## Decision 5: Row limit and scan budget estimation

**Decision**: Default row limit of 100 rows (configurable via constructor); `scanBytesUsed` estimated as `rowCount × 1024` bytes (1 KB per row heuristic)  
**Rationale**: 100 rows is sufficient for the agent to identify data discrepancies; returning thousands of rows bloats the LLM context. The 1 KB per row estimate is conservative and consistent with typical database row sizes; it ensures budget accounting without requiring a `EXPLAIN` round-trip before every query.  
**Alternatives considered**:
- `EXPLAIN` before every query — correct but doubles round-trips and adds complexity
- No scan budget — violates spec FR-007 and constitution §V (scan budget is a cross-cutting concern)

---

## Decision 6: Per-query timeout enforcement

**Decision**: Set `statement_timeout` via a `SET` command immediately after connecting, before the SELECT query  
**Rationale**: `pg` does not expose a per-query timeout directly, but Aurora PostgreSQL honours the `statement_timeout` session variable. The tool issues `SET statement_timeout = ${timeoutMs}` as the first command on each new connection, then executes the SELECT. If the SELECT exceeds the timeout, the server cancels it and `pg` surfaces a `query_canceled` error — which the tool catches and returns as a structured timeout error result.  
**Default**: 10 000 ms (10 seconds), configurable via constructor.  
**Alternatives considered**:
- `pg`'s `query` with `AbortController` / Node.js `setTimeout` — cancels client-side but leaves the query running server-side; not acceptable for a read-only production tool
- Connection-level timeout in `pg.Client` options (`connectionTimeoutMillis`) — only covers the connection phase, not query execution
