# Tasks: Aurora PostgreSQL DB Query Tool

**Input**: Design documents from `specs/002-aurora-db-query-tool/`  
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | quickstart.md ✅

**Tests**: Tests are REQUIRED for this feature — constitution §VI mandates that every new tool ships with a unit test, an integration test, and at least one eval scenario.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies and create the directory structure. No code yet.

- [x] T001 Add `pg`, `@aws-sdk/rds-signer` to `dependencies` and `@types/pg` to `devDependencies` in `package.json`, then run `npm install`
- [x] T002 Create directory `src/tools/extensions/aurora-db/` (empty — populated in Phase 2+)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Three pure modules that `AuroraDbTool` depends on. All are stateless and independently unit-testable. Must be complete before Phase 3.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] Implement `src/tools/extensions/aurora-db/AuroraDbGuard.ts` — export `assertSelectOnly(query: string): void` that uppercases the first whitespace-delimited token of the trimmed query and throws `Error("WRITE_REJECTED: ...")` if it is not `SELECT`; cyclomatic complexity ≤ 3
- [x] T004 [P] Implement `src/tools/extensions/aurora-db/AuroraDbCatalogReader.ts` — define `AuroraDatabaseConfig` interface (fields: `host`, `port`, `database`, `username`, `region`, `credentialSource: "iam" | "env-var"`, optional `envPasswordVar`); load `service-catalog.yml` via `readFileSync` + `js-yaml` in the constructor; expose `resolve(serviceId: string, environment: string): AuroraDatabaseConfig | null` that returns the matching entry or `null`
- [x] T005 Implement `src/tools/extensions/aurora-db/AuroraDbCredentials.ts` — export `async function resolvePassword(config: AuroraDatabaseConfig): Promise<string>`; when `credentialSource === "iam"` call `RDSSigner.getAuthToken({ hostname: config.host, port: config.port, region: config.region, username: config.username })`; when `credentialSource === "env-var"` read `process.env[config.envPasswordVar]` and throw if missing; cyclomatic complexity ≤ 4; depends on T004 for `AuroraDatabaseConfig` type

**Checkpoint**: Three foundational modules exist. User story implementation can now begin.

---

## Phase 3: User Story 1 — Correlate Log Evidence with Database State (Priority: P1) 🎯 MVP

**Goal**: The agent can call `aurora-db` with a service name, environment, and SELECT statement and receive structured row data that appears as evidence in the investigation report.

**Independent Test**: Register `AuroraDbTool` against a mock `pg.Client` that returns a single row `{ id: "ord-1", status: "pending" }`, invoke the tool with a valid SELECT, and assert `result.success === true` and `result.data.rows[0].status === "pending"`.

### Tests for User Story 1

- [x] T006 [P] [US1] Create `tests/unit/tools/aurora-db.test.ts` and write unit test: valid SELECT returns `{ success: true }` with populated `rows` array and correct `rowCount`, `rowCap`, `scanBytesUsed`, and `truncated: false` — mock `pg.Client` via constructor injection
- [x] T007 [P] [US1] Write unit test in `tests/unit/tools/aurora-db.test.ts`: non-SELECT query (`UPDATE`, `DELETE`, `DROP`) is rejected before any `pg.Client` is instantiated and returns `{ success: false, error: containing "WRITE_REJECTED" }`
- [x] T008 [P] [US1] Write unit test in `tests/unit/tools/aurora-db.test.ts`: query returning zero rows returns `{ success: true, data: { rows: [], rowCount: 0, truncated: false } }`
- [x] T009 [P] [US1] Write unit test in `tests/unit/tools/aurora-db.test.ts`: `pg.Client` throws on `connect()` → tool returns `{ success: false, error: ... }` with no exception propagated
- [x] T010 [P] [US1] Write unit test in `tests/unit/tools/aurora-db.test.ts`: query exceeds `statement_timeout` causing `pg` to raise a `query_canceled` error → tool returns `{ success: false, error: containing timeout signal }` and client is closed in `finally` (covers FR-006, SC-003)
- [x] T011 [P] [US1] Write unit test in `tests/unit/tools/aurora-db.test.ts`: query returning `rowCap + 1` rows → `truncated: true`, `rows.length === rowCap`, and `result.data.rowCap` equals the configured cap value
- [x] T012 [P] [US1] Write unit test in `tests/unit/tools/aurora-db.test.ts`: `scanBytesUsed` in the returned `ToolResult` equals `rowCount * 1024`
- [x] T013 [P] [US1] Create `tests/integration/extensions/aurora-db.test.ts` and write integration test: `AuroraDbTool` registers in `ToolRegistry` under name `"aurora-db"`, appears in `getToolDefinitions()` output, and returns a structured error (not a throw) when catalog has no entry for the requested service/environment

### Implementation for User Story 1

- [x] T014 [US1] Implement `src/tools/extensions/aurora-db/AuroraDbTool.ts` — class `AuroraDbTool implements Tool`; `readonly name = "aurora-db"`; constructor accepts `catalogPath: string` and optional `{ maxRows?: number; queryTimeoutMs?: number }`; `invoke(input: unknown): Promise<ToolResult>` follows the state transition in `data-model.md`: (1) validate with Zod, (2) call `assertSelectOnly`, (3) `catalogReader.resolve`, (4) `resolvePassword`, (5) open `pg.Client` with SSL `require`, issue `SET statement_timeout = ${queryTimeoutMs}`, execute SELECT, (6) collect up to `rowCap + 1` rows to detect truncation, (7) close client in `finally`, (8) return `AuroraDbResult` including `rowCap` field; split into private helper methods to keep each method's CC ≤ 10; depends on T003, T004, T005
- [x] T015 [US1] Create `src/tools/extensions/aurora-db/index.ts` — re-export `AuroraDbTool` and `AuroraDatabaseConfig` as the public surface of the extension

### Eval Fixtures and Scenario for User Story 1

- [x] T016 [P] [US1] Create `evals/fixtures/S011/cloudwatch-response.json` — mock CloudWatch log entries showing order `ord-9876` processed by the order-service with log message indicating status `completed`; follow existing fixture shape from `evals/fixtures/S001/cloudwatch-response.json`
- [x] T017 [P] [US1] Create `evals/fixtures/S011/aurora-db-response.json` — mock `AuroraDbResult` with one row `{ "id": "ord-9876", "status": "pending", "updated_at": "2026-05-01T09:12:34.000Z" }` representing the authoritative database state; `truncated: false`, `rowCount: 1`, `rowCap: 100`
- [x] T018 [US1] Create `evals/scenarios/S011-aurora-db.json` — scenario for `observationType: "data-discrepancy"`, service `order-service`, environment `production`, linking key `ord-9876`, `groundTruth.likelyFailurePoint: "order-service-db-state"`, `groundTruth.rootCauseKeywords: ["pending", "status discrepancy", "database", "ord-9876"]`; wire fixtures for both `cloudwatch-logs` and `aurora-db`; follow the existing scenario schema from `evals/scenarios/S001.json`; depends on T016, T017

**Checkpoint**: `AuroraDbTool` is fully functional and tested. US1 is independently verifiable by running `npm run test` and `npm run test:integration`.

---

## Phase 4: User Story 2 — Validate Data Integrity Across Tables (Priority: P2)

**Goal**: Multi-table JOIN queries return all result columns correctly and the evidence in the report identifies each contributing table distinctly.

**Independent Test**: Invoke `AuroraDbTool` with a SELECT that JOINs two tables (e.g., `orders` and `order_items`), mock the `pg.Client` to return rows with aliased columns (e.g., `orders.status`, `items.quantity`), and assert that all column names appear in the returned `rows` objects.

### Tests for User Story 2

- [x] T019 [P] [US2] Write unit test in `tests/unit/tools/aurora-db.test.ts`: multi-table JOIN SELECT with aliased column names (`orders.status AS orders_status, items.qty AS items_qty`) returns all aliased columns in each row object; mock `pg.Client` returns two columns per row
- [x] T020 [P] [US2] Write unit test in `tests/unit/tools/aurora-db.test.ts`: query with a CTE (`WITH cte AS (...)`) is rejected by `assertSelectOnly` since the first token is `WITH` (not `SELECT`); returns `{ success: false, error: containing "WRITE_REJECTED" }` — documents the v1 CTE limitation per `research.md` Decision 3

### Implementation for User Story 2

- [x] T021 [US2] Update the `description` field on `AuroraDbTool` in `src/tools/extensions/aurora-db/AuroraDbTool.ts` to explicitly state: multi-table JOINs are supported; column aliases should include the table name to make the evidence source clear in the report; CTEs (`WITH ... SELECT`) are not supported in v1
- [x] T022 [P] [US2] Add a comment in `src/tools/extensions/aurora-db/AuroraDbGuard.ts` documenting the known limitation: `WITH` (CTE) is rejected as a first token in v1; reference the research decision for future extension

**Checkpoint**: Multi-table queries work via the existing SELECT mechanism. Report evidence from JOIN queries is readable because column aliases carry table context. US2 is independently verifiable.

---

## Phase 5: User Story 3 — Environment-Scoped Database Targeting (Priority: P3)

**Goal**: The tool always connects to the Aurora cluster registered for the exact service/environment pair; serving the wrong environment is impossible.

**Independent Test**: Create a test `service-catalog.yml` fixture with distinct `host` values for `production` and `staging` of the same service; call `AuroraDbCatalogReader.resolve()` for each environment and assert different `host` values are returned.

### Tests for User Story 3

- [x] T023 [P] [US3] Write unit test in `tests/unit/tools/aurora-db.test.ts`: `AuroraDbCatalogReader.resolve("order-service", "production")` and `AuroraDbCatalogReader.resolve("order-service", "staging")` return different `host` values when the fixture catalog has distinct entries
- [x] T024 [P] [US3] Write unit test in `tests/unit/tools/aurora-db.test.ts`: `AuroraDbCatalogReader.resolve("order-service", "canary")` returns `null` when no `canary` entry exists, and `AuroraDbTool.invoke()` returns `{ success: false, error: containing "NO_DB_CONFIGURED" }`
- [x] T025 [P] [US3] Write unit test in `tests/unit/tools/aurora-db.test.ts`: `AuroraDbCatalogReader.resolve("unknown-service", "production")` returns `null`

### Implementation for User Story 3

- [x] T026 [US3] Extend `service-catalog.yml` with `auroraDatabase` entries for `order-service` (production and staging) and `payment-service` (production and staging) using the schema defined in `data-model.md`; use placeholder hostnames following the Aurora endpoint naming convention shown in `quickstart.md`
- [x] T027 [P] [US3] Verify `AuroraDbCatalogReader.ts` (from T004) correctly handles the `canary` environment missing from `auroraDatabase` entries — add a defensive `?? null` return path if not already present; no structural changes needed if already implemented correctly in T004

**Checkpoint**: Environment routing is verified. Wrong-environment connections are structurally impossible — the catalog lookup fails before any connection is attempted. US3 is independently verifiable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Ensure the whole feature passes all CI gates before merge.

- [x] T028 [P] Inspect `evals/accuracy/runner.eval.ts` and add `aurora-db` fixture loading support if the runner does not already handle unknown fixture keys generically; ensure S011 is picked up and the aurora-db mock responses are injected correctly during accuracy eval runs (covers SC-001 / C2)
- [x] T029 [P] Run `npm run typecheck` and fix any TypeScript strict-mode errors introduced by the new files
- [x] T030 [P] Run `npm run lint` and fix any ESLint errors or warnings (zero warnings permitted per constitution §II)
- [x] T031 Run `npm run test` and confirm all unit tests pass including all new aurora-db tests
- [x] T032 Run `npm run test:integration` and confirm all integration tests pass including `aurora-db.test.ts`
- [x] T033 Run `npm run eval:structural` and confirm all structural evals still pass (no regressions)
- [x] T034 Run `npm run build` and confirm the TypeScript compiler produces no errors and the `dist/` output is clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — **BLOCKS** all user stories; T003+T004 can run in parallel; T005 is sequential after T004
- **US1 (Phase 3)**: Depends on Phase 2 completion; T006–T013 (tests) and T016–T017 (fixtures) are all [P] and can run in parallel; T014 depends on T003, T004, T005; T015 depends on T014; T018 depends on T016 and T017
- **US2 (Phase 4)**: Depends on T014 (AuroraDbTool.ts exists); no dependency on US3
- **US3 (Phase 5)**: Depends on T004 (AuroraDbCatalogReader.ts exists); no dependency on US1 or US2
- **Polish (Phase 6)**: Depends on all user story phases completing

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Phase 2 — no dependency on US2 or US3
- **User Story 2 (P2)**: Starts after T014 — no dependency on US3
- **User Story 3 (P3)**: Starts after T004 — no dependency on US1 or US2

### Within Phase 3 (US1)

1. T003, T004, T005 must complete first (foundational); T003+T004 parallel, T005 sequential after T004
2. T006–T013 (all tests, marked [P]) and T014 (implementation) can start in parallel from Phase 3's start — write tests to fail, then implement
3. T016, T017 (fixtures, both [P]) can run in parallel with tests
4. T015 (index.ts) depends on T014
5. T018 (scenario) depends on T016 and T017

---

## Parallel Example: Phase 2 + Phase 3 start

```
# Phase 2 — T003 and T004 in parallel; T005 sequential after T004:
Task T003: AuroraDbGuard.ts          ─┐
Task T004: AuroraDbCatalogReader.ts  ─┘ (parallel)
Task T005: AuroraDbCredentials.ts       (sequential, depends on T004)

# Phase 3 — once T003+T004+T005 complete, launch in parallel:
Task T006: unit test — valid SELECT
Task T007: unit test — non-SELECT rejection
Task T008: unit test — zero rows
Task T009: unit test — connection failure
Task T010: unit test — query execution timeout  ← new
Task T011: unit test — row cap truncation
Task T012: unit test — scanBytesUsed
Task T013: integration test — registry
Task T014: AuroraDbTool.ts implementation
Task T016: eval fixture cloudwatch-response.json
Task T017: eval fixture aurora-db-response.json
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks US1)
3. Complete Phase 3: US1 — implement tool + tests + eval
4. **STOP and VALIDATE**: `npm run test && npm run test:integration && npm run eval:structural`
5. The agent can now query Aurora and correlate logs with DB state

### Incremental Delivery

1. Setup + Foundational → core modules ready
2. US1 → working tool with tests + eval (MVP)
3. US2 → multi-table JOIN guidance + CTE limitation test
4. US3 → environment isolation verified + catalog extended
5. Polish → CI green

### Parallel Team Strategy

With two developers after Phase 2 completes:

- Developer A: US1 (T006–T018) — core tool + tests + eval
- Developer B: US3 (T023–T027) — catalog extension + environment routing tests
- Then both converge on US2 (T019–T022) and Polish (T028–T034)

---

## Notes

- [P] tasks target different files and have no incomplete dependencies — safe to run in parallel
- [Story] labels map each task to a specific user story for traceability
- Tests must be written (and must fail) before implementation for each story
- Constitution §VI makes tests non-optional: unit + integration + eval are all required
- CTE (`WITH ... SELECT`) is a known v1 limitation — documented in T022, not a defect
- Test files are created as part of the first test task (T006 for unit, T013 for integration) — do not create empty placeholder files
- Commit after each phase checkpoint to keep the branch history clean
