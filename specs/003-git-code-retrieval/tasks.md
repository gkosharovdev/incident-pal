# Tasks: Git Code Retrieval & Repo Documentation Tools

**Input**: Design documents from `specs/003-git-code-retrieval/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ quickstart.md ✅

**Note on tests**: Tests are required (not optional) for this feature. The constitution (§VI) mandates a unit test and an integration test for every new tool before merge.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US5 maps to spec.md)

---

## Phase 1: Setup

**Purpose**: Install the new dependency and scaffold the three new directories so downstream tasks have clear targets.

- [X] T001 Add `@octokit/rest` to dependencies in `package.json` and run `npm install`
- [X] T002 Create empty directory stubs: `src/tools/extensions/git-shared/`, `src/tools/extensions/git-code-retrieval/`, `src/tools/extensions/repo-documentation/`, `evals/fixtures/S012/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure that all five user stories depend on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: T003 (GitProvider interface) blocks T004 and T005. T004, T005, T006 are independent once T003 is done.

- [X] T003 Define `GitProvider` interface and all return types (`CommitInfo`, `FileDiff`, `FileContent`, `VersionComparison`, `SymbolMatch`, `DirectoryEntry`) in `src/tools/extensions/git-shared/GitProvider.ts` per `data-model.md`
- [X] T004 [P] Implement `GitHubProvider` class wrapping an injected `Octokit` instance with all five methods (`getCommit`, `getFileContent`, `compareCommits`, `searchSymbol`, `listDirectory`) in `src/tools/extensions/git-shared/GitHubProvider.ts`
- [X] T005 [P] Implement `GitCatalogReader` that reads `repositoryUrl` from `service-catalog.yml` and parses `{owner}/{repo}` from the GitHub URL in `src/tools/extensions/git-shared/GitCatalogReader.ts`
- [X] T006 [P] Add `repositoryUrl` field to all five services (`order-service`, `notification-service`, `payment-service`, `customer-service`, `dispatch-service`) in `service-catalog.yml`

**Checkpoint**: Shared infrastructure ready — all five user story phases can now start.

---

## Phase 3: User Story 1 — View Code Changes for a Deployed Version (Priority: P1) 🎯 MVP

**Goal**: Agent can call `git-code-retrieval` with a commit SHA or tag from ECS and receive the commit metadata plus the full diff of changed files.

**Independent Test**: Register `GitCodeRetrievalTool` in a `ToolRegistry`, invoke it with a mock `GitProvider` returning a known commit, and assert the `ToolResult` contains `success: true`, the correct `sha`, and a populated `files` array.

- [X] T007 [US1] Create `GitCodeRetrievalTool` class with `INPUT_SCHEMA`, constructor accepting `GitProvider` + `catalogPath` + `options?: { maxDiffBytes?: number; maxSymbolResults?: number; requestTimeoutMs?: number }`, and `invoke()` dispatcher that routes on `operation` field in `src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.ts`
- [X] T008 [US1] Implement `handleGetCommit()` private method: validates `ref` present, calls `catalogReader.resolve()`, calls `provider.getCommit()`, applies `MAX_DIFF_BYTES` cap across all file diffs with `truncated: true` flag in `src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.ts`
- [X] T009 [P] [US1] Create `src/tools/extensions/git-code-retrieval/index.ts` re-exporting `GitCodeRetrievalTool`
- [X] T010 [P] [US1] Write unit tests for `get-commit` operation (valid SHA returns commit + diff, **valid tag ref resolves correctly — mock `provider.getCommit()` called with tag string**, diff cap sets `truncated`, **`requestTimeoutMs` enforced — mock provider throws timeout `GitProviderError`, asserts `success: false`**, no catalog entry returns `NO_REPO_CONFIGURED` error, `GitProviderError` 404 returns structured error, missing `ref` field returns structured error) in `tests/unit/tools/git-code-retrieval.test.ts`
- [X] T011 [US1] Write integration test: register `GitCodeRetrievalTool` in `ToolRegistry`, assert discoverable by name `"git-code-retrieval"`, assert `getToolDefinitions()` includes the tool schema, assert error result (not throw) when catalog has no `repositoryUrl` in `tests/integration/extensions/git-code-retrieval.test.ts`

**Checkpoint**: US1 fully functional and tested. `get-commit` operation end-to-end via mock provider.

---

## Phase 4: User Story 4 — Read Architecture and Business Documentation (Priority: P1)

**Goal**: Agent can call `repo-documentation` with a `serviceId` and receive the content of all discovered documentation files (README, AGENTS.md, .specify/, adr/, docs/adr/).

**Independent Test**: Register `RepoDocumentationTool` with a mock `GitProvider` whose `listDirectory` and `getFileContent` return controlled responses. Invoke the tool and assert the result contains the expected files; invoke with a repo missing `.specify/` and assert it is silently skipped without error.

- [X] T012 [US4] Implement `RepoDocumentationTool` class with `INPUT_SCHEMA`, constructor accepting `GitProvider` + `catalogPath` + `options?: { maxFileSizeBytes?: number; requestTimeoutMs?: number }`, and `invoke()` method that scans all `WELL_KNOWN_DOC_PATHS`, silently skips 404s, applies `MAX_DOC_FILE_BYTES` per file, and returns `DocumentationResult` in `src/tools/extensions/repo-documentation/RepoDocumentationTool.ts`
- [X] T013 [P] [US4] Create `src/tools/extensions/repo-documentation/index.ts` re-exporting `RepoDocumentationTool`
- [X] T014 [P] [US4] Write unit tests for `RepoDocumentationTool` (all paths present returns all files, missing paths skipped silently, file exceeds byte cap sets `truncated: true` on that entry, **`requestTimeoutMs` enforced — mock provider throws timeout `GitProviderError`, asserts `success: false`**, no catalog entry returns structured error) in `tests/unit/tools/repo-documentation.test.ts`
- [X] T015 [US4] Write integration test: register `RepoDocumentationTool` in `ToolRegistry`, assert discoverable by name `"repo-documentation"`, assert schema present in `getToolDefinitions()` in `tests/integration/extensions/repo-documentation.test.ts`

**Checkpoint**: US4 fully functional and tested. Documentation tool end-to-end via mock provider.

---

## Phase 5: User Story 2 — Retrieve File Content at a Specific Version (Priority: P2)

**Goal**: Agent can call `git-code-retrieval` with `operation: "get-file"`, a `ref`, and a `filePath` and receive the full text content of that file as it existed at that commit.

**Independent Test**: Invoke `GitCodeRetrievalTool` with operation `"get-file"`, mock provider returns known content, assert `ToolResult.data.content` matches; invoke with a non-existent file path (mock provider throws `GitProviderError` 404), assert `success: false` and meaningful error message.

- [X] T016 [US2] Implement `handleGetFile()` private method: validates `ref` and `filePath` present, calls `provider.getFileContent()`, applies `MAX_DOC_FILE_BYTES` cap with `truncated` flag in `src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.ts`
- [X] T017 [US2] Add unit tests for `get-file` operation (valid path returns content, content cap sets `truncated`, 404 returns structured error, missing `filePath` field returns structured error) to `tests/unit/tools/git-code-retrieval.test.ts`

**Checkpoint**: US2 functional. File content retrieval tested.

---

## Phase 6: User Story 5 — Trace Method Invocations for a Hypothesis (Priority: P2)

**Goal**: Agent can call `git-code-retrieval` with `operation: "search-symbol"` and a method or class name and receive a list of file paths and line numbers where that symbol appears in the repository.

**Independent Test**: Invoke `GitCodeRetrievalTool` with operation `"search-symbol"` and symbol `"PaymentProcessor"`, mock provider returns three matches, assert result has three `SymbolMatch` entries; invoke with symbol that matches nothing, assert `success: true` with empty `matches` array.

- [X] T018 [US5] Implement `handleSearchSymbol()` private method: validates `symbol` present, calls `provider.searchSymbol()`, caps at `MAX_SYMBOL_RESULTS` with `truncated` flag in `src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.ts`
- [X] T019 [US5] Add unit tests for `search-symbol` operation (matches returned correctly, zero matches returns `success: true` with empty array, results capped at limit sets `truncated: true`, missing `symbol` field returns structured error) to `tests/unit/tools/git-code-retrieval.test.ts`

**Checkpoint**: US5 functional. Symbol search tested including the zero-match case.

---

## Phase 7: User Story 3 — Compare Two Versions (Priority: P3)

**Goal**: Agent can call `git-code-retrieval` with `operation: "compare"`, `baseRef`, and `headRef` and receive the aggregate diff of all files changed between the two commits.

**Independent Test**: Invoke `GitCodeRetrievalTool` with operation `"compare"` and two known SHAs, mock provider returns a known comparison, assert `ToolResult.data.totalFilesChanged` and `files` array are correct; invoke with `baseRef` newer than `headRef` (mock provider returns empty diff or error), assert graceful handling.

- [X] T020 [US3] Implement `handleCompare()` private method: validates `baseRef` and `headRef` present, calls `provider.compareCommits()`, checks that head is a descendant of base (returns `INVALID_REF_ORDER` structured error if reversed), applies `MAX_DIFF_BYTES` cap across all file diffs in `src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.ts`
- [X] T021 [US3] Add unit tests for `compare` operation (valid comparison returns aggregate diff, diff cap applies across files, **reversed ref order returns `success: false` with `INVALID_REF_ORDER` error**, missing `baseRef` or `headRef` returns structured error) to `tests/unit/tools/git-code-retrieval.test.ts`

**Checkpoint**: All five user stories functional. Complete tool implementation done.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Constitution amendment (prerequisite for T023), system prompt update, eval scenario, fixture files, and final quality gate verification.

**⚠️ NOTE**: T022 MUST be completed before T023. The constitution amendment documents the governance approval for the `prompts.ts` change.

- [X] T022 Record constitution amendment v1.2.0 in `.specify/memory/constitution.md`: add the additive-prompt-change exemption clause to §VI and bump version to 1.2.0 with rationale — **prerequisite for T023** *(already applied by /speckit-analyze remediation; verify content matches plan.md Phase 4 intent before proceeding)*
- [X] T023 Append the "Code & Architecture Analysis" investigation sequence section to `SYSTEM_PROMPT` in `src/agent/prompts.ts` per the wording in `plan.md` Phase 4 — additive change only, no existing prompt text modified; permitted by constitution §VI amendment v1.2.0
- [X] T024 Create eval scenario `evals/scenarios/S012-deployment-code-change.json` with `scenarioId: "S012"`, `observationType: "deployment-impact"`, ground truth keywords `["PaymentProcessor", "charge", "null check", "deployment", "v2.4.1"]`, and fixture references per `plan.md` Phase 7
- [X] T025 [P] Create fixture `evals/fixtures/S012/cloudwatch-response.json` with mock CloudWatch log entries showing `NullPointerException` in `PaymentProcessor.charge()` for `pay-5678`
- [X] T026 [P] Create fixture `evals/fixtures/S012/ecs-deployment-response.json` with mock ECS deployment record for `payment-service` version `v2.4.1` timestamped 3 minutes before the log errors
- [X] T027 [P] Create fixture `evals/fixtures/S012/git-code-retrieval-response.json` with mock `get-commit` result showing removal of a null check in `PaymentProcessor.ts`
- [X] T028 [P] Create fixture `evals/fixtures/S012/repo-documentation-response.json` with mock documentation result containing a minimal README and one ADR describing the payment flow
- [X] T029 Run `npm run typecheck && npm run lint && npm test && npm run test:integration && npm run eval:structural` and confirm all quality gates pass with zero errors and zero warnings

**Checkpoint**: All quality gates green. Feature complete and ready for PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1; T003 must complete before T004 and T005 — **blocks all user story phases**
- **Phase 3 (US1)**: Depends on Phase 2 complete
- **Phase 4 (US4)**: Depends on Phase 2 complete — **independent of Phase 3**, can run in parallel with it
- **Phase 5 (US2)**: Depends on Phase 3 (T007 tool skeleton must exist)
- **Phase 6 (US5)**: Depends on Phase 3 (T007 tool skeleton must exist) — can run in parallel with Phase 5
- **Phase 7 (US3)**: Depends on Phase 3 (T007 tool skeleton must exist) — can run in parallel with Phases 5 and 6
- **Phase 8 (Polish)**: Depends on Phases 3–7 complete; T022 (constitution) must precede T023 (prompt update)

### User Story Dependencies

- **US1 (P1)**: Requires Phase 2 complete — foundational to US2, US3, US5
- **US4 (P1)**: Requires Phase 2 complete — fully independent of US1
- **US2 (P2)**: Requires US1 tool skeleton (T007) — adds `get-file` operation
- **US5 (P2)**: Requires US1 tool skeleton (T007) — adds `search-symbol` operation; independent of US2
- **US3 (P3)**: Requires US1 tool skeleton (T007) — adds `compare` operation; independent of US2 and US5

### Within Each Phase

- Tests are written after the implementation they cover (same phase, sequential within phase)
- `index.ts` tasks marked [P] can run in parallel with test writing tasks
- `GitCodeRetrievalTool.ts` is modified across Phases 3, 5, 6, 7 — only one phase should touch it at a time

---

## Parallel Opportunities

### After Phase 2 completes, maximum parallelism:

```
Phase 3 (US1): T007 → T008 → [T009 || T010] → T011
Phase 4 (US4): T012 → [T013 || T014] → T015
```

Both can run simultaneously with different developers.

### Within Phase 8 (once Phases 3–7 complete):

```
T022 (constitution amendment) — first; prerequisite for T023
T023 (prompts.ts)             — after T022
T024 (scenario JSON)          — independent of T022/T023
T025 || T026 || T027 || T028  (four fixture files, all independent)
T029 (quality gates)          — after T022–T028
```

---

## Implementation Strategy

### MVP First (US1 + US4 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — **required, blocks everything**
3. Complete Phase 3: US1 (get-commit) → validate independently
4. Complete Phase 4: US4 (repo-documentation) → validate independently
5. **STOP and VALIDATE**: Both P1 stories functional, agent can read docs and view deployment diffs
6. Optionally deliver here before adding US2, US5, US3

### Incremental Delivery

1. Setup + Foundational → base ready
2. US1 → agent can correlate deployment SHA with code diff (MVP!)
3. US4 → agent understands service architecture before diving into diffs
4. US2 → agent can read full files for deep logic analysis
5. US5 → agent can trace method call chains from log entries
6. US3 → agent can compare across multi-commit deployments
7. Polish → system prompt wires everything together in the report

### Parallel Team Strategy

After Phase 2:
- Developer A: Phase 3 (US1 — GitCodeRetrievalTool skeleton + get-commit)
- Developer B: Phase 4 (US4 — RepoDocumentationTool)

After Phase 3:
- Developer A: Phase 5 (US2 — get-file) then Phase 7 (US3 — compare)
- Developer B: Phase 6 (US5 — search-symbol) then Phase 8 (Polish — T022 first, then T023, then fixtures)

---

## Notes

- [P] tasks operate on different files and have no dependency on other incomplete tasks in the same phase
- Constitution §VI requires unit + integration tests for every new tool — tests are mandatory here, not optional
- `GitCodeRetrievalTool.ts` accumulates handlers across Phases 3, 5, 6, 7 — do not start a later phase's handler until the previous phase is fully committed
- `SYSTEM_PROMPT` change in T022 invalidates the Anthropic prompt cache for one warm-up iteration; this is expected and acceptable
- All fixture files in Phase 8 are JSON — they can be written in any order
- Run `npm run eval:structural` after T028 to catch any structural regressions introduced by the prompt change
