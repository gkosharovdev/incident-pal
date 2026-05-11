# Tasks: Log Group Filter Criteria

**Input**: Design documents from `specs/005-log-group-filter-criteria/`
**Branch**: `005-log-group-filter-criteria`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no blocking dependency)
- **[Story]**: User story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

---

## Phase 1: Setup

No new project structure is needed — this feature extends an existing TypeScript project in-place.

- [X] T001 Verify `npm run build` and `npm test` are green before starting work (baseline check)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type definitions and fixture updates that all user story phases depend on.

**⚠️ CRITICAL**: US1 and US2 phases cannot begin until this phase is complete.

- [X] T002 Define and export `LogGroupFilter` interface (`{ type: "prefix" | "pattern"; value: string }`) in `src/tools/service-catalog/ServiceCatalogTool.ts` — needed by both `ServiceCatalogTool` and `LogGroupDiscoveryTool`
- [X] T003 [P] Add `logGroupFilters` entries to `alpha-service` in `tests/fixtures/service-catalog-test.yml` so existing service-catalog tests cover the new field

**Checkpoint**: Shared types exported; fixture updated — US1 and US2 can now proceed.

---

## Phase 3: User Story 1 — Catalog Schema (Priority: P1) 🎯 MVP

**Goal**: Service catalog entries can declare `logGroupFilters` (list of prefix/pattern expressions) instead of a single log group. Legacy single-`logGroup` entries continue to work unchanged.

**Independent Test**: Load `tests/fixtures/service-catalog-test.yml` with both a legacy entry and a `logGroupFilters` entry; verify `invoke()` and `resolve()` return `logGroupFilters` in the result; verify legacy entry synthesises an equivalent filter.

### Implementation for User Story 1

- [X] T004 [US1] Extend `ServiceEntry` interface with `logGroupFilters?: Record<string, LogGroupFilter[]>` and `maxLogGroups?: number`, and extend `ServiceLookupResult` with `logGroupFilters: LogGroupFilter[]` and `maxLogGroups: number` in `src/tools/service-catalog/ServiceCatalogTool.ts`. In the `ServiceCatalogTool` constructor, after parsing the YAML, validate every `LogGroupFilter` entry: assert `type` is `"prefix"` or `"pattern"` and `value` is a non-empty string — throw `INVALID_FILTER_TYPE: <value>` or `INVALID_FILTER_VALUE` at **load time** (FR-010, M2). Also assert that every service entry has at least one of `logGroups` or `logGroupFilters` defined for each declared environment — throw `MISSING_LOG_GROUP_CONFIG: <serviceId>/<env>` at **load time** if neither is present (spec edge case: "neither field → error at catalog load time", M3).
- [X] T005 [US1] Implement backward-compat synthesis: in `invoke()` and `resolve()`, when `logGroupFilters[env]` is present and non-empty, use it directly; otherwise synthesise `[{ type: "prefix", value: logGroups[env] }]` from the legacy field. The "neither exists" case is now caught at load time (T004) so `invoke()`/`resolve()` can assume at least one source is present in `src/tools/service-catalog/ServiceCatalogTool.ts`
- [X] T006 [P] [US1] Add `logGroupFilters` block to `booking-service` in `service-catalog.yml` with at least one `prefix` filter covering the ECS log group and one `pattern` filter for cross-namespace discovery
- [X] T007 [US1] Extend `tests/unit/tools/service-catalog.test.ts` with assertions that: (a) a `logGroupFilters` entry returns filters in the result; (b) a legacy `logGroups` entry synthesises an equivalent single prefix filter; (c) `maxLogGroups` defaults to 50 when omitted

**Checkpoint**: `npm test` passes; `ServiceCatalogTool` returns `logGroupFilters` for both old and new catalog entries.

---

## Phase 4: User Story 2 — Log Group Discovery Tool (Priority: P1)

**Goal**: A new `LogGroupDiscoveryTool` (`log-group-discovery`) accepts filter expressions, calls AWS `DescribeLogGroups`, and returns de-duplicated concrete log group names capped at `maxGroups` (default 50). The agent prompt instructs the agent to call this tool after the catalog lookup.

**Independent Test**: With mocked AWS responses, `LogGroupDiscoveryTool.invoke()` returns the correct group list for prefix and pattern filters, de-duplicates overlapping results, sets `capped: true` when the cap is hit, and returns `groups: []` (not an error) when no groups match.

### Implementation for User Story 2

- [X] T008 [US2] Implement `LogGroupDiscoveryTool` in `src/tools/cloudwatch/LogGroupDiscoveryTool.ts` with: input schema matching the contract in `specs/005-log-group-filter-criteria/contracts/log-group-discovery-tool.md`; `DescribeLogGroupsCommand` calls for each filter; pagination loop capped at `maxGroups`; name-based de-duplication; `{ groups, capped, totalFound }` success shape. **Error handling**: `AccessDeniedException` (and any `ResourceNotFoundException`) MUST return `success: true` with `groups: []` and a `warning` string — the investigation must continue gracefully (spec edge case: "AWS account has no CloudWatch Logs access — discovery fails gracefully"). All other unexpected AWS errors return `success: false` (fail-fast). Also: when `capped` is `true`, set `result.truncated = true` on the returned `ToolResult` so `InvestigationAgent` auto-emits a `result-truncated` trace entry (FR-008).
- [X] T009 [US2] Write unit tests for `LogGroupDiscoveryTool` in `tests/unit/tools/log-group-discovery.test.ts` covering: prefix filter match, pattern filter match, zero-match returns `success: true` with `groups: []`, cap triggers `capped: true` and `result.truncated`, de-duplication across two overlapping filters, `AccessDeniedException` returns `success: true` with `groups: []` and a `warning`, unexpected AWS error returns `success: false`
- [X] T009b [US2] Write a recorded-fixture integration test for `LogGroupDiscoveryTool` in `tests/unit/tools/log-group-discovery.test.ts` (same file, separate `describe` block, following the recorded-mock pattern in `tests/unit/tools/cloudwatch.test.ts`): record a realistic `DescribeLogGroupsCommand` response fixture for a prefix filter returning two groups; assert the parsed `DiscoveredGroup[]` output matches exactly. **Required by constitution §VI** — every new tool must have an integration test or recorded fixture.
- [X] T010 [P] [US2] Register `LogGroupDiscoveryTool` in `src/tui/hooks/useInvestigation.ts` — add `new LogGroupDiscoveryTool(cwClient)` to the `tools` array passed to `InvestigationAgent`
- [X] T011 [P] [US2] Register `LogGroupDiscoveryTool` in `src/cli/index.ts` — add `new LogGroupDiscoveryTool(cwClient)` to the `tools` array passed to `InvestigationAgent`
- [X] T012 [US2] Add step 1b to `SYSTEM_PROMPT` in `src/agent/prompts.ts` (additive only — append after existing step 1): instruct the agent that when the catalog result contains `logGroupFilters`, it MUST call `log-group-discovery` with those filters before issuing any `cloudwatch-logs` queries, and proceed with all discovered group names; if discovery returns zero groups or a `warning`, record the miss and continue
- [X] T012b [US2] Create eval fixture in `evals/fixtures/` for an investigation scenario that exercises `log-group-discovery`: a golden-set trace where the agent calls `service-catalog` → `log-group-discovery` (returns 2 groups) → `cloudwatch-logs` (once per group). Add a structural assertion (Tier 1 eval) that the trace contains a `tool-call` entry for `log-group-discovery` before any `cloudwatch-logs` entries. **Required by constitution §VI** — every new tool must have an eval fixture.

**Checkpoint**: `npm run build && npm test` passes; the new tool is registered with unit tests, a recorded fixture, and an eval fixture; an investigation targeting `booking-service` will call `log-group-discovery` before CloudWatch queries.

---

## Phase 5: User Story 3 — Report Scope Visibility (Priority: P2)

**Goal**: The investigation report lists every CloudWatch log group that was actually queried, so operators can trust the scope of findings.

**Independent Test**: A completed investigation whose trace contains two `cloudwatch-logs` tool-call entries produces a report whose markdown content includes both log group names in the data sources section.

### Implementation for User Story 3

- [X] T013 [US3] Add `logGroupsQueried: string[]` field to `ReportMetadata` interface in `src/models/Investigation.ts`
- [X] T014 [US3] Populate `logGroupsQueried` in `buildInvestigation()` in `src/agent/InvestigationAgent.ts` by extracting `(entry.input as { logGroup?: string }).logGroup` from all `tool-call` trace entries where `entry.toolName === "cloudwatch-logs"`, de-duplicating. **Note**: this is metadata collection from existing trace entries — it does not add support for a new data source and is not prohibited by constitution §VI. The modification is confined to `buildInvestigation()` metadata assembly only.
- [X] T015 [US3] Render queried log groups in the Data Sources section of the markdown report in `src/report/ReportRenderer.ts`. Retrieve the `log-group-discovery` tool-call trace entry (if present) to obtain `groups[].{name, filter}` provenance. Group the output by filter expression: for each filter, render a sub-heading with the filter type and value, then list the log group names beneath it. If a filter produced zero matches, render it with the note "no matching log groups found" — **do not omit it** (SC-005 requires the report to explicitly state which filter returned no matches). If no `log-group-discovery` entry exists in the trace, fall back to listing `logGroupsQueried` flat with no filter grouping.

**Checkpoint**: `npm run build && npm test` passes; a report produced from a trace with cloudwatch calls lists the queried log groups.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Update `tests/unit/tools/aurora-db.test.ts` or any other existing test that references hardcoded log group strings if they break after the schema changes
- [X] T017 Run `npm run build && npm test` end-to-end; fix any TypeScript type errors introduced by the new `logGroupsQueried` field propagating to existing code that constructs `ReportMetadata` literals
- [X] T018 [P] Verify `npm run lint` passes with zero warnings; fix any ESLint issues in the new and modified files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS US1 and US2
- **Phase 3 (US1)**: Depends on Phase 2 — `LogGroupFilter` type must exist before `ServiceCatalogTool` uses it
- **Phase 4 (US2)**: Depends on Phase 2 — `LogGroupFilter` type must exist; can run in parallel with Phase 3 after Phase 2 completes
- **Phase 5 (US3)**: Depends on Phase 4 (agent registers discovery tool before report wiring makes sense); single-developer: do after Phase 4
- **Phase 6 (Polish)**: Depends on all story phases

### User Story Dependencies

- **US1 (P1)**: Requires T002 (type export) and T003 (fixture update)
- **US2 (P1)**: Requires T002 (type export); can start in parallel with US1 after Phase 2
- **US3 (P2)**: Requires US2 complete (needs tool registered to produce realistic traces)

### Within Each Phase

- Tasks marked [P] within the same phase touch different files and have no dependency on each other
- T005 (backward-compat logic) must complete before T007 (tests) in Phase 3
- T008 (tool implementation) must complete before T009 and T009b (tests) in Phase 4 — write both together, TDD-style
- T012b (eval fixture) can be written in parallel with T010/T011 once T008 is complete
- T013 and T014 must complete before T015 in Phase 5

---

## Parallel Opportunities

```
After Phase 2 completes:

  Developer A (or Agent turn A):
    Phase 3 US1: T004 → T005 → T006+T007

  Developer B (or Agent turn B):
    Phase 4 US2: T008+T009+T009b → T010+T011+T012b → T012
```

Within Phase 3: T006 (service-catalog.yml) can be done in parallel with T004+T005.
Within Phase 4: T010 and T011 (wiring in two files) can be done in parallel once T008 is complete.

---

## Implementation Strategy

### MVP (US1 + US2 only — delivers working multi-log-group investigations)

1. Complete Phase 2 (Foundational) — 2 tasks
2. Complete Phase 3 (US1) — 4 tasks — catalog accepts filter expressions
3. Complete Phase 4 (US2) — 5 tasks — agent discovers and queries multiple groups
4. **STOP and VALIDATE**: Run a real investigation against `booking-service dev`; confirm the agent calls `log-group-discovery` and queries multiple groups
5. Ship MVP — US3 (report visibility) can follow as a fast-follow

### Full Delivery

1. MVP above
2. Phase 5 (US3) — 3 tasks — report names every queried group
3. Phase 6 (Polish) — 3 tasks — lint, type-check, regression sweep

---

## Notes

- Constitution §VI requires `LogGroupDiscoveryTool` to have unit tests (T009) — not optional
- `SYSTEM_PROMPT` change (T012) is additive only per constitution §III amendment v1.2.0
- Do not modify `CloudWatchLogsTool` — it queries one group per call; the agent issues multiple calls
- `logGroup` field on `ServiceLookupResult` is kept for backward compatibility; do not remove it
- All new code must pass `npm run lint` with zero warnings before marking tasks complete
