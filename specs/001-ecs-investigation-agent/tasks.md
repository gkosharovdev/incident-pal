# Tasks: Production Investigation Agent

**Input**: Design documents from `specs/001-ecs-investigation-agent/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅  
**Regenerated**: 2026-04-30 — incorporates clarifications: observation-type-agnostic scope, `observationDescription` input, wall-clock timeout (FR-015), toolset split (3 core + reference extension), eval diversity requirement (≥3 observation types)

**Tech stack**: TypeScript 5.x (strict), Node.js LTS, Vitest, `@anthropic-ai/sdk`, AWS SDK v3  
**Tests/Evals**: Included per constitution clause II — all must remain green on every merge

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story this task belongs to (US1–US4)

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Scaffold the TypeScript project, toolchain, and eval harness structure.

- [x] T001 Initialize npm package with `package.json`, `tsconfig.json` (strict mode, `noImplicitAny`, `strictNullChecks`), and `vitest.config.ts` at repo root
- [x] T002 [P] Add ESLint + Prettier config (`.eslintrc.json`, `.prettierrc`) enforcing no-`any` rule and cyclomatic-complexity ≤ 10
- [x] T003 [P] Create directory skeleton: `src/agent/`, `src/tools/`, `src/models/`, `src/report/`, `src/cli/`, `tests/unit/`, `tests/integration/`, `evals/structural/`, `evals/accuracy/`, `evals/scenarios/`, `evals/fixtures/`, `evals/results/`
- [x] T004 [P] Add `.gitignore` entries for `evals/results/`, `node_modules/`, `dist/`
- [x] T005 [P] Add npm scripts to `package.json`: `test`, `test:integration`, `eval:structural`, `eval:accuracy`, `build`, `lint`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, interfaces, and infrastructure that every user story depends on. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: Completes before Phase 3+

- [x] T006 Implement all core TypeScript types from data-model.md in `src/models/Investigation.ts`: `InvestigationRequest` (including optional `observationDescription: string`), `LinkingKey`, `TimeWindow`, `Investigation`, `InvestigationStatus` (`running` | `complete` | `failed` | `budget-exhausted` | `timed-out`), `Trace`, `TraceEntry`, `TraceEntryType`, `Report`, `Hypothesis`, `EvidenceItem`, `Confidence`; re-export all from `src/models/index.ts`
- [x] T007 [P] Implement the `Tool` interface and `ToolResult` type (from `contracts/tool-interface.md`) in `src/models/Tool.ts`
- [x] T008 [P] Implement Zod validation schemas for `InvestigationRequest` in `src/models/validation.ts`: service ID non-empty, at least one linking key, time window ordering, `observationDescription` optional string ≤ 500 chars
- [x] T009 Implement `ToolRegistry` — registers tools by name, looks up by name, returns all tool definitions for LLM prompt construction — in `src/agent/ToolRegistry.ts`
- [x] T010 Implement append-only `Trace` with `appendEntry(entry: TraceEntry): void` and `getEntries(): readonly TraceEntry[]` — entries immutable after write — in `src/models/Trace.ts`
- [x] T011 [P] Implement static `ServiceCatalogTool` loading `service-catalog.yml` from configurable path, resolving service names, environments, and linking key schemas in `src/tools/service-catalog/ServiceCatalogTool.ts`
- [x] T012 [P] Create `service-catalog.yml` at repo root with at least two example services covering different observation types (notification pipeline, payment processing)
- [x] T013 [P] Implement `ScanBudget` class with `canAfford(estimatedBytes: number): boolean` and `record(bytesUsed: number): void` in `src/agent/ScanBudget.ts`
- [x] T014 [P] Implement `InvestigationTimer` class: wraps a wall-clock timeout (configurable, default 10 min), exposes `isExpired(): boolean` and `remainingMs(): number`, emits `timed-out` trace entry on expiry, in `src/agent/InvestigationTimer.ts`
- [x] T015 [P] Unit tests for `Trace`, `ToolRegistry`, `ScanBudget`, `InvestigationTimer`, and Zod validation schemas in `tests/unit/models/`
- [x] T016 [P] Unit tests for `ServiceCatalogTool` (valid service, unknown service, missing env) in `tests/unit/tools/service-catalog.test.ts`

**Checkpoint**: Foundation ready — all types, interfaces, timer, scan budget, and validation in place

---

## Phase 3: User Story 1 — Investigate a User-Impacting Observation (Priority: P1) 🎯 MVP

**Goal**: Engineer provides service name, environment, at least one linking key, optional observation description, and optional time window. Agent queries CloudWatch logs, ECS deployments, and entity correlation (core tools), returns a complete Markdown report within the 10-minute wall-clock timeout.

**Independent Test**: Provide a known past incident (established root cause, any observation type) with recorded fixture data; verify the report identifies the correct failure point with observation description in the summary, all tool calls in the trace, and completion within timeout.

### Evals for User Story 1 — Structural (Tier 1)

> Write these first. They must FAIL before implementation and PASS after.

- [x] T017 [P] [US1] Structural eval: assert report contains all required sections (summary with observationDescription when provided, timeline, evidence, hypotheses, likelyFailurePoint, recommendedActions, metadata) in `evals/structural/report-structure.eval.ts`
- [x] T018 [P] [US1] Structural eval: assert every tool call has a corresponding `TraceEntry` (no unrecorded calls) in `evals/structural/trace-completeness.eval.ts`
- [x] T019 [P] [US1] Structural eval: assert no tool call response mutates production state (write-path safety gate) in `evals/structural/safety-readonly.eval.ts`
- [x] T020 [P] [US1] Structural eval: assert unknown service returns `UNKNOWN_SERVICE` error before investigation starts in `evals/structural/input-validation.eval.ts`
- [x] T021 [P] [US1] Structural eval: assert investigation with unavailable tool continues, records gap, qualifies confidence — using mock unavailable tool in `evals/structural/tool-unavailability.eval.ts`
- [x] T022 [P] [US1] Structural eval: assert investigation reaching wall-clock timeout produces `timed-out` status, partial report with warning, and `timed-out` TraceEntry in `evals/structural/timeout-enforcement.eval.ts`
- [x] T023 [P] [US1] Structural eval: assert when `observationDescription` is provided it appears verbatim in `report.structured.summary.observationDescription` in `evals/structural/observation-description.eval.ts`

### Implementation for User Story 1

- [x] T024 [P] [US1] Implement `CloudWatchLogsTool`: `StartQuery`/`GetQueryResults` polling via `@aws-sdk/client-cloudwatch-logs`, enforces result-count threshold, records `scanBytesUsed`, parses each result entry as JSON (records `unparseable-log-entry` TraceEntry and skips non-JSON entries without failing), returns structured JSON evidence items in `src/tools/cloudwatch/CloudWatchLogsTool.ts`
- [x] T025 [P] [US1] Implement `EcsDeploymentTool`: queries `DescribeServices` for deployment timestamps within time window via `@aws-sdk/client-ecs` in `src/tools/ecs/EcsDeploymentTool.ts`
- [x] T026 [P] [US1] Implement `CustomerCorrelationTool`: resolves entity type + entity ID to customer-level metadata via configurable HTTP client in `src/tools/customer-correlation/CustomerCorrelationTool.ts`
- [x] T027 [US1] Implement system prompt and tool description templates in `src/agent/prompts.ts`: include `observationDescription` in the initial investigation context when provided; add Anthropic prompt caching markers on static sections — depends on T024–T026 tool descriptions
- [x] T028 [US1] Implement `InvestigationAgent` ReAct loop in `src/agent/InvestigationAgent.ts`: accepts `InvestigationRequest`, applies default 1-hour time window when `request.timeWindow` is absent (documented in report), runs Anthropic tool-use loop checking `InvestigationTimer.isExpired()` before each iteration, enforces scan budget, records `TraceEntry` per tool call, returns `Investigation` — depends on T009, T010, T013, T014, T027
- [x] T029 [US1] Implement `ReportRenderer` in `src/report/ReportRenderer.ts`: converts `Investigation` to `Report` with `markdownContent`; includes `observationDescription` verbatim in summary section; emits warning section when status is `timed-out` or `budget-exhausted` — depends on T028
- [x] T030 [US1] Implement CLI entrypoint in `src/cli/index.ts` using `commander`: flags `--service`, `--env`, `--entity-id`, `--http-correlation-id`, `--kafka-message-id`, `--description` (maps to `observationDescription`); `--from` and `--to` are optional (omitting both defaults to past 60 minutes); writes Markdown to stdout, trace JSON to `./traces/<id>.json` — depends on T028, T029
- [x] T031 [P] [US1] Unit tests for `CloudWatchLogsTool` (result truncation, scan budget, polling, unparseable JSON entry recorded as `unparseable-log-entry` TraceEntry and skipped) with mocked AWS client in `tests/unit/tools/cloudwatch.test.ts`
- [x] T032 [P] [US1] Unit tests for `EcsDeploymentTool` and `CustomerCorrelationTool` with mocked responses in `tests/unit/tools/ecs.test.ts` and `tests/unit/tools/customer-correlation.test.ts`
- [x] T033 [US1] Unit tests for `InvestigationAgent`: max-iterations halt, `timed-out` status on timeout, `budget-exhausted` status, trace entry per tool call, `observationDescription` passed to prompt — with mock tools in `tests/unit/agent/InvestigationAgent.test.ts`
- [x] T034 [US1] Unit tests for `ReportRenderer`: all sections present, `observationDescription` in summary, timeout warning present when `timed-out`, null `likelyFailurePoint` when uncertain in `tests/unit/report/ReportRenderer.test.ts`
- [x] T035 [US1] Record fixture for golden-set scenario S001 (missing notification — outbox event dropped, known root cause) in `evals/fixtures/S001/`
- [x] T036 [US1] Create golden-set scenario S001 in `evals/scenarios/S001.json` (observation type: `notification-failure`); add to accuracy eval runner in `evals/accuracy/runner.eval.ts`

**Checkpoint**: US1 functional — CLI works end-to-end; structural evals green; S001 passes; timeout and observationDescription working

---

## Phase 4: User Story 2 — Cross-Service Evidence Correlation (Priority: P2)

**Goal**: Agent follows evidence across service boundaries using whichever linking key is provided. It automatically extracts and follows additional linking keys (entity IDs, HTTP correlation IDs, Kafka message IDs) discovered in logs.

**Independent Test**: Provide an entity ID traceable across two services with recorded fixture data (e.g., payment processing chain); verify report includes evidence from both services and trace shows `linking-key-discovered` entries.

### Evals for User Story 2 — Structural (Tier 1)

- [x] T037 [P] [US2] Structural eval: assert report includes evidence from ≥2 services when fixture data spans multiple services in `evals/structural/cross-service-correlation.eval.ts`
- [x] T038 [P] [US2] Structural eval: assert `linking-key-discovered` TraceEntry recorded each time a new linking key is found in `evals/structural/linking-key-discovery.eval.ts`

### Implementation for User Story 2

- [x] T039 [P] [US2] Implement `LinkingKeySet` (add/has/iterate, deduplication, immutable snapshot) in `src/models/LinkingKey.ts`
- [x] T040 [P] [US2] Implement `LinkingKeyExtractor` in `src/agent/LinkingKeyExtractor.ts`: given a structured JSON log entry and a `LinkingKeySchema` (field-name → type mapping from service catalog), extracts all linking keys present
- [x] T041 [US2] Extend `InvestigationAgent` (`src/agent/InvestigationAgent.ts`): maintain `activeLinkingKeys: LinkingKeySet`, run `LinkingKeyExtractor` after each CloudWatch result, add newly discovered keys, append `linking-key-discovered` trace entries, include new keys in subsequent queries — extends T028
- [x] T042 [P] [US2] Extend `service-catalog.yml` with `linkingKeySchema` per service (e.g., `traceId: http-correlation`, `orderId: entity-id`, `messageId: kafka-message-id`, `paymentId: entity-id`)
- [x] T043 [P] [US2] Unit tests for `LinkingKeyExtractor` (all three key types, multiple keys per entry, unknown fields ignored) in `tests/unit/agent/LinkingKeyExtractor.test.ts`
- [x] T044 [US2] Record fixture for golden-set scenario S002 (incorrect order status — crosses order-service + status-service via entity ID, observation type: `incorrect-status`) in `evals/fixtures/S002/`
- [x] T045 [US2] Create and add golden-set scenario S002 to `evals/scenarios/S002.json` and `evals/accuracy/runner.eval.ts`; assert evidence from both services present and root cause identified

**Checkpoint**: US2 complete — agent follows linking keys across services; S002 passes

---

## Phase 5: User Story 3 — Reproducible Investigation Trace (Priority: P3)

**Goal**: Every investigation produces a self-contained trace file. A colleague can read it and understand all queries, evidence, and conclusions. Re-running with the same fixture data produces an equivalent trace.

**Independent Test**: Run an investigation, verify trace JSON written to `./traces/<id>.json` with complete `TraceEntry` record; verify second run produces equivalent trace.

### Evals for User Story 3 — Structural (Tier 1)

- [x] T046 [P] [US3] Structural eval: assert trace file written to `./traces/<id>.json` after CLI invocation contains all required `TraceEntry` fields in `evals/structural/trace-persistence.eval.ts`
- [x] T047 [P] [US3] Structural eval: assert trace contains `investigation-started` as first entry and `investigation-complete` (or `timed-out`) as last entry in `evals/structural/trace-bookends.eval.ts`

### Implementation for User Story 3

- [x] T048 [P] [US3] Implement `TraceSerializer` in `src/models/TraceSerializer.ts`: serialises `Trace` to JSON with schema version field; validates schema version on deserialisation; rejects malformed JSON
- [x] T049 [US3] Extend CLI `src/cli/index.ts` to write serialised trace to `./traces/<investigationId>.json` after investigation completes — extends T030, depends on T048
- [x] T050 [P] [US3] Implement fixture recorder script `scripts/record-fixture.ts`: runs investigation against live environment and saves tool responses as fixture files in `evals/fixtures/<scenario-id>/` for golden-set eval creation
- [x] T051 [P] [US3] Unit tests for `TraceSerializer` (round-trip, schema version, invalid JSON rejection) in `tests/unit/models/TraceSerializer.test.ts`

**Checkpoint**: US3 complete — trace files written; readable and reproducible

---

## Phase 6: User Story 4 — Extend the Agent with a New Data Source (Priority: P4)

**Goal**: Platform engineers register a new tool following the `Tool` interface contract; agent discovers and invokes it without core changes. Ships with a notification outbox reference extension as a concrete template.

**Independent Test**: Register mock tool returning known JSON; run investigation; verify agent invokes it, output in report, call in trace. Register notification outbox reference extension; verify it works end-to-end.

### Evals for User Story 4 — Structural (Tier 1)

- [x] T052 [P] [US4] Structural eval: register mock tool, run investigation, assert mock tool called and output in evidence in `evals/structural/tool-extensibility.eval.ts`
- [x] T053 [P] [US4] Structural eval: register mock tool that throws, assert investigation continues and `tool-error` entry in trace in `evals/structural/tool-error-recovery.eval.ts`

### Implementation for User Story 4

- [x] T054 [P] [US4] Implement `NotificationOutboxTool` as the bundled reference extension in `src/tools/extensions/notification-outbox/NotificationOutboxTool.ts`: queries outbox state by linking key and time window via configurable HTTP client; full docblock showing the extension pattern; registered at runtime, not in core
- [x] T055 [P] [US4] Integration test: register `NotificationOutboxTool` in a test `ToolRegistry`, run investigation with fixture data, assert tool called and output in report in `tests/integration/extensions/notification-outbox.test.ts`
- [x] T056a [P] [US4] Record fixture and create golden-set scenario covering `NotificationOutboxTool` (observation type: `notification-failure`) in `evals/fixtures/S001-outbox/` and `evals/scenarios/S001-outbox.json`; add to accuracy eval runner — satisfies constitution VI requirement that every new tool has an eval fixture
- [x] T056 [P] [US4] Integration test: register third-party mock tool at construction time, confirm included in LLM tool definitions list in `tests/integration/registry/tool-registration.test.ts`
- [x] T057 [US4] Implement and unit-test tool-error recovery in `InvestigationAgent`: when `tool.invoke()` returns `{ success: false }` or throws, append `tool-error` TraceEntry, mark source unavailable, lower confidence, continue — tests in `tests/unit/agent/tool-error-recovery.test.ts`

**Checkpoint**: US4 complete — extension mechanism verified; notification outbox reference implementation ships as template

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Bring golden-set eval suite to ≥10 scenarios spanning ≥3 observation types, wire CI, complete operational readiness.

- [x] T058 [P] Record fixtures and create golden-set scenarios S003–S010 covering: payment not processed (observation type: `payment-failure`), faulty data / incorrect customer record (`data-discrepancy`), ECS deployment rollback correlation (`deployment-impact`), Kafka message ID tracing cross-service, budget-exhausted partial report, timed-out partial report, no-evidence-found report, multi-hypothesis report — add all to `evals/accuracy/runner.eval.ts`; verify suite spans ≥3 distinct observation types (SC-001)
- [x] T059 [P] Implement accuracy eval reporter `evals/accuracy/reporter.ts`: reads `evals/results/` JSON, prints pass rate and per-scenario verdict, exits non-zero if accuracy < 80% OR if suite covers fewer than 3 distinct observation types
- [x] T060 Add CI configuration (`.github/workflows/ci.yml`): `npm run lint` + `npm test` + `npm run test:integration` + `npm run eval:structural` on every PR; `npm run eval:accuracy` on merge to main
- [x] T061 [P] Update `service-catalog.yml` with ≥5 services covering all golden-set scenario observation types
- [x] T062 [P] Update `contracts/investigation-invocation.md`: add `observationDescription` to input contract, add `timed-out` to `InvestigationOutput.status`, add `TIMED_OUT` error code
- [x] T063 [P] Update `data-model.md`: add `observationDescription?: string` to `InvestigationRequest`, add `timed-out` to `InvestigationStatus` enum, add `timed-out` to `TraceEntryType`
- [x] T064 [P] SOLID/clean-code review pass: verify SRP, OCP, LSP, ISP, DIP across all modules; cyclomatic complexity ≤ 10; no `any` without suppression comment in all `src/` files
- [x] T065 [P] Update `quickstart.md`: add `--description` CLI flag example, document wall-clock timeout env var (`MAX_DURATION_MS`), show notification outbox registration example, update IAM policy
- [x] T066 Run `npm run eval:accuracy` against full golden-set; confirm accuracy ≥ 80% across ≥3 observation types; record baseline in `evals/results/baseline.json`
- [x] T067 [P] Write `README.md` at repo root: installation prerequisites and `npm install` step, Quickstart section with CLI invocation examples (entity ID, HTTP correlation ID, Kafka message ID), how to run tests (`npm test`, `npm run test:integration`), how to run evals (`npm run eval:structural`, `npm run eval:accuracy`), environment variables table, link to `quickstart.md` for full detail

**Checkpoint**: All phases complete — tests green, evals green, accuracy ≥ 80% across ≥3 observation types, CI configured

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — blocks all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — MVP deliverable; introduces timeout and observationDescription
- **US2 (Phase 4)**: Depends on Phase 2; extends `InvestigationAgent` from Phase 3
- **US3 (Phase 5)**: Depends on Phase 3 (extends CLI); can run alongside Phase 4
- **US4 (Phase 6)**: Depends on Phase 2; largely independent of Phase 3/4/5
- **Polish (Phase 7)**: Depends on all user story phases

### User Story Dependencies

- **US1 (P1)**: No story dependencies — pure MVP path
- **US2 (P2)**: Extends `InvestigationAgent` (T041 extends T028); independently testable via separate fixtures
- **US3 (P3)**: Extends CLI (T049 extends T030); independently testable without US2
- **US4 (P4)**: Extends `ToolRegistry` (Phase 2); independently testable without US1/2/3

### Within Each Phase

- Structural evals → written first, must fail before implementation tasks
- Models → before services/tools
- Tools (T024–T026) → before agent loop (T028)
- Agent loop → before report renderer (T029) and CLI (T030)
- Fixtures → before golden-set accuracy evals

### Parallel Opportunities

- All [P]-marked tasks within a phase run concurrently
- US3 and US4 can proceed in parallel once Phase 3 is complete
- The three core tool implementations (T024, T025, T026) and the reference extension (T054) are fully parallel
- Golden-set scenarios S003–S010 (T058) can be recorded in parallel across team members

---

## Parallel Example: Phase 3 (US1) Core Tools + Evals

```
# All structural evals in parallel (different files):
T017: report-structure.eval.ts
T018: trace-completeness.eval.ts
T019: safety-readonly.eval.ts
T020: input-validation.eval.ts
T021: tool-unavailability.eval.ts
T022: timeout-enforcement.eval.ts
T023: observation-description.eval.ts

# All three core tool implementations in parallel (different files):
T024: CloudWatchLogsTool.ts
T025: EcsDeploymentTool.ts
T026: CustomerCorrelationTool.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (includes `InvestigationTimer` for timeout)
3. Write structural evals T017–T023 — confirm they fail
4. Complete Phase 3: US1 implementation
5. **STOP AND VALIDATE**: `npm run eval:structural` (all 7 pass) + `npm run eval:accuracy` (S001 passes)
6. Demo: `npx incident-pal investigate --service order-service --env production --entity-id order:ord-12345 --description "payment not processed"`

### Incremental Delivery

- Phase 3 done → CLI works, observation-agnostic report, timeout guaranteed, MVP shippable
- Phase 4 done → cross-service investigations work (payment chain, status propagation)
- Phase 5 done → traces saved, reproducible, post-incident review ready
- Phase 6 done → extension mechanism validated, notification outbox reference template ships
- Phase 7 done → ≥10 scenarios across ≥3 observation types, CI wired, accuracy ≥ 80%

### Parallel Team Strategy (if 2+ developers)

1. Team completes Phase 1 + Phase 2 together
2. Dev A: Phase 3 (US1) + Phase 4 (US2) sequentially
3. Dev B: Phase 6 (US4) immediately, then Phase 5 (US3) after Phase 3
4. Both converge on Phase 7 (Polish)

---

## Notes

- `[P]` tasks operate on different files — safe to parallelise within a phase
- Constitution clause II: all tests and evals pass before any merge — no skipping
- Constitution clause III: SOLID/clean-code review on every PR (explicit T064 task in Phase 7)
- Structural evals use mock tools only — no live AWS calls, run in <30 sec
- Accuracy evals call live Anthropic API against recorded fixtures — run on main merge only
- `evals/results/` is gitignored; CI uploads as build artefact
- Wall-clock timeout default: 10 min (`MAX_DURATION_MS` env var)
- Scan budget default: 1 GB (`SCAN_BUDGET_BYTES` env var)
- `NotificationOutboxTool` ships in `src/tools/extensions/` — registered at runtime, not in core
- Total tasks: **68** | US1: 20 | US2: 9 | US3: 6 | US4: 7 | Setup+Foundation: 16 | Polish: 10
