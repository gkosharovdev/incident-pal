# Feature Specification: Aurora PostgreSQL DB Query Tool

**Feature Branch**: `002-aurora-db-query-tool`  
**Created**: 2026-05-01  
**Status**: Draft  
**Input**: User description: "aurora postgresql db tool which enables querying the db of the concrete service under investigation so that the agent can correlate the logs with the data itself in that particular environment"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correlate Log Evidence with Database State (Priority: P1)

During an investigation, the agent has gathered log evidence suggesting a failure at a particular point in the system — for example, logs indicate an order was processed by one service but the database shows it was never persisted, or a notification was dispatched but no corresponding record exists. The agent queries the Aurora PostgreSQL database for the service under investigation in the relevant environment (e.g., production, staging), retrieves the actual data rows, and includes the database state as evidence in the report alongside the log evidence.

**Why this priority**: The most common class of incidents involves a discrepancy between what the logs say happened and what the database actually reflects. Without direct database access, the agent can only correlate log-to-log; adding database evidence closes the most critical evidence gap.

**Independent Test**: Can be fully tested by providing a known incident where the root cause is a data discrepancy (e.g., a row exists in one table but not another), running the agent with the Aurora tool registered, and verifying the report includes the database evidence alongside the log evidence.

**Acceptance Scenarios**:

1. **Given** the agent is investigating a service with an Aurora PostgreSQL database registered in the service catalog for that environment, **When** the agent queries the database using a linking key (e.g., order ID), **Then** it returns the matching rows and their current state, which appear as a labelled evidence section in the investigation report.
2. **Given** the database query returns no matching rows for the provided linking key, **When** the agent processes the result, **Then** it records "no rows found" as evidence (not an error) and the report notes the absence explicitly.
3. **Given** the query result would return an unusually large number of rows (exceeding a configured threshold), **When** the tool executes the query, **Then** it returns only the first N rows, marks the result as truncated, and the report notes that results were capped.
4. **Given** the database is unreachable or the query fails, **When** the tool encounters the failure, **Then** it returns a structured error result, the agent records the failure in the trace, and the investigation continues using available evidence.

---

### User Story 2 - Validate Data Integrity Across Tables (Priority: P2)

An engineer is investigating a data discrepancy observation — for example, an order appears in one service's database with status "completed" but the corresponding record in another table (or a downstream service's database) shows "pending". The agent queries multiple tables within the same database (or the same database visible to the service) to surface the inconsistency as concrete evidence.

**Why this priority**: Cross-table discrepancy is a common root cause for incorrect-status and data-quality observations. This extends the P1 story to multi-table queries, which significantly increases diagnostic coverage without adding architectural complexity.

**Independent Test**: Can be tested independently by registering the tool against a test database with a known cross-table inconsistency, running a query that spans both tables, and verifying the agent's report identifies the discrepancy.

**Acceptance Scenarios**:

1. **Given** the agent issues a query that joins or compares multiple tables within the service's database, **When** the tool executes it, **Then** the result includes rows from all involved tables and is returned to the agent as a single structured result.
2. **Given** the agent receives cross-table data, **When** it includes it in the report, **Then** the evidence section identifies each table source distinctly so an engineer can trace which table produced which values.

---

### User Story 3 - Environment-Scoped Database Targeting (Priority: P3)

The same service runs in multiple environments (production, staging, canary). When an investigation targets a specific environment, the agent must query the database instance for that environment — never the wrong one. The tool resolves the correct Aurora cluster and database name for the given service and environment combination without the engineer having to specify connection details manually.

**Why this priority**: Querying the wrong environment's database would produce misleading evidence. This is a safety and correctness concern that must be solved before the tool is usable in practice, but it depends on the service catalog (already in place) rather than new capability.

**Independent Test**: Can be tested by invoking the tool for two different environments of the same service and verifying the tool connects to distinct database endpoints and returns distinct data.

**Acceptance Scenarios**:

1. **Given** an investigation targeting environment `production`, **When** the Aurora tool executes a query, **Then** it connects to the Aurora cluster registered for that service in `production`, not any other environment.
2. **Given** a service has no Aurora database registered in the service catalog for the requested environment, **When** the tool is invoked, **Then** it returns a clear error stating that no database is configured for that service/environment pair, and the investigation continues without database evidence.

---

### Edge Cases

- What happens when the provided linking key matches thousands of rows? The tool must cap results at a configurable row limit, mark the result as truncated, and surface a warning in the report.
- What happens when the query contains a non-SELECT statement (e.g., UPDATE, DELETE, DROP)? The tool must reject the query before execution and return a structured error; no non-SELECT statement is ever executed.
- What happens when the Aurora cluster is in a different AWS region than the investigating process? The tool resolves the connection endpoint from the service catalog and connects regardless of region — region is an attribute of the catalog entry, not a concern of the caller.
- What happens when the database connection pool is exhausted or the cluster is under high load? The tool enforces a per-query wall-clock timeout; if the query does not complete within that window, it returns a timeout error result and the agent continues.
- What happens when credentials for the Aurora database are not available in the current environment? The tool returns a structured authentication error; the investigation continues and the report notes the credential gap.
- What happens when the schema changes (e.g., a column the agent expected no longer exists)? The query fails at execution time; the tool returns the database error as a structured result and the agent records it in the trace.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST accept a SQL SELECT statement, a service name, and an environment as inputs. The service name and environment are used to resolve the target Aurora cluster from the service catalog.
- **FR-002**: The tool MUST execute only SELECT statements. Any query that contains non-SELECT SQL keywords (INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, EXEC, CALL, or equivalent) MUST be rejected before execution and return a structured error result. No write operation is ever sent to the database.
- **FR-003**: The tool MUST resolve the Aurora cluster connection details (host, port, database name, credentials) from the service catalog entry for the specified service and environment, without requiring the agent or engineer to supply raw connection strings.
- **FR-004**: The tool MUST return query results as structured data (an array of rows, each row as a key-value map of column name to value) so the agent can reason over individual fields.
- **FR-005**: The tool MUST cap query results at a configurable maximum row count. When results are truncated, the tool MUST set `truncated: true` in the result and include the row cap value so the agent can surface a warning in the report.
- **FR-006**: The tool MUST enforce a configurable per-query wall-clock timeout. If the query does not complete within the timeout, the tool MUST cancel the query, return a timeout error result, and never leave an open transaction or cursor on the server.
- **FR-007**: The tool MUST record the number of rows scanned or an estimated data volume in the `scanBytesUsed` result field so the investigation's scan budget is correctly tracked.
- **FR-008**: When the service catalog contains no Aurora database entry for the specified service and environment, the tool MUST return a structured "not configured" error rather than attempting any connection.
- **FR-009**: When the database is unreachable, credentials are invalid, or the query fails for any reason, the tool MUST return `{ success: false, data: null, error: "<description>" }` rather than throwing — the agent records a `tool-error` trace entry and continues the investigation.
- **FR-010**: The tool MUST be registered as an extension tool (under `src/tools/extensions/`) following the existing Tool interface contract. It MUST NOT modify any file under `src/agent/` or `src/models/`.
- **FR-011**: The tool MUST ship with a unit test, an integration test (or recorded fixture), and at least one eval scenario that exercises a database correlation step in an investigation.

### Key Entities

- **AuroraDbTool**: The extension tool that encapsulates all database query logic; implements the `Tool` interface; registered by the caller at `InvestigationAgent` construction time.
- **DatabaseCatalogEntry**: The service catalog record for a service/environment pair that specifies Aurora cluster host, port, database name, and credential reference; looked up by `ServiceCatalogTool` or an equivalent catalog reader.
- **QueryResult**: The structured output of a successful database query — an array of row objects plus metadata (row count, whether truncated, estimated bytes scanned).
- **QueryInput**: The tool's input schema — service name, environment, and a SQL SELECT statement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When the agent investigates an incident that has a database-level root cause (e.g., a missing or incorrect row), the investigation report correctly includes the relevant database evidence in at least 80% of golden-set eval scenarios that involve a database correlation step — matching the overall accuracy threshold from spec 001.
- **SC-002**: The tool rejects 100% of non-SELECT queries before any database connection is attempted — verified by dedicated unit test assertions.
- **SC-003**: Query results are available to the agent within the per-query timeout (default: 10 seconds); the tool never blocks the investigation loop indefinitely.
- **SC-004**: A platform engineer can register the Aurora tool for a new service's investigation in under half a day of integration work — measured by adding a catalog entry and wiring the tool at construction time, with no changes to core agent files.
- **SC-005**: 100% of Aurora tool invocations (success or failure) appear in the investigation trace — no database call goes unrecorded.

## Assumptions

- The service catalog already supports (or will be extended to support) Aurora PostgreSQL connection details per service/environment; this spec does not define the catalog schema extension but depends on it.
- Credentials for Aurora are available to the running process via the standard AWS credential chain (IAM roles, environment variables, or AWS Secrets Manager); the tool does not implement its own credential storage.
- All queried databases use the PostgreSQL wire protocol; no MySQL, Oracle, or other engine variants are in scope.
- The agent (LLM) is responsible for formulating relevant SELECT queries based on the investigation context; the tool does not generate queries autonomously.
- Row-level security and database-level access controls are the responsibility of the database and AWS IAM configuration; the tool does not enforce application-level row filtering.
- The tool is used exclusively during investigations; connection pooling and high-throughput use cases are out of scope — a single connection per query invocation is acceptable.
- PII present in database rows is subject to the same policy as PII in logs (spec 001): protection is delegated entirely to the underlying data source access controls; the tool does not redact or anonymise data.
