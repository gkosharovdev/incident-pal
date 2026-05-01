# Tasks: TUI Agent Monitor

**Input**: Design documents from `/specs/004-tui-agent-monitor/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US5 as defined in spec.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies, configure TypeScript for React JSX, and add the TUI build step.

- [ ] T001 Add new npm dependencies to package.json and install: `ink`, `react`, `@types/react`, `keytar`, `@aws-sdk/shared-ini-file-loader`, `ink-text-input`, `ink-testing-library`
- [ ] T002 Create `tsconfig.tui.json` extending `tsconfig.json` with `"jsx": "react-jsx"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"include": ["src/tui/**/*"]`
- [ ] T003 Add `"build:tui": "tsc --project tsconfig.tui.json"` and update `"typecheck"` script in `package.json` to also check `tsconfig.tui.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add optional `onTraceEntry?: (entry: TraceEntry) => void` callback field to `InvestigationAgentConfig` in `src/agent/InvestigationAgent.ts`, invoke it synchronously inside `recordToolResult()` after `state.trace.appendEntry(entry)`, wrapped in try/catch so exceptions do not interrupt the investigation loop
- [ ] T005 [P] Create directory structure `src/tui/screens/`, `src/tui/components/`, `src/tui/hooks/`, `src/tui/services/`, `tests/unit/tui/`, `tests/integration/tui/`
- [ ] T006 Create `src/tui/App.tsx` — root Ink component implementing the screen router state machine with states: `setup-wizard | investigation-form | stream-view | report-view | settings`; initially renders nothing (screens wired in subsequent phases)
- [ ] T007 Create `src/tui/index.tsx` — TUI entry point: detect headless mode (`!process.stdout.isTTY || flags.headless`); in headless mode validate `ANTHROPIC_API_KEY` + `AWS_PROFILE` env vars and exit 0 or exit 1 with error; in interactive mode start Ink app rendering `<App />`
- [ ] T008 Add `tui` subcommand to `src/cli/index.ts` using Commander: accepts `--headless` boolean flag, calls `src/tui/index.tsx` entry point

**Checkpoint**: Foundation ready — all user story phases can now begin.

---

## Phase 3: User Story 2 — First-Launch Credential Setup (Priority: P1)

**Goal**: Guide new users through entering an Anthropic API key and selecting an AWS profile on first launch; allow returning to settings to update credentials at any time.

**Independent Test**: Launch TUI with empty OS keychain → wizard appears → complete wizard → credentials retrievable from keychain → investigation form shown. Verify SettingsScreen updates keychain entries. Run: `npm test -- tests/unit/tui/ && npm run test:integration -- tests/integration/tui/credential-setup.test.ts`

- [ ] T009 [P] [US2] Create `src/tui/services/KeychainService.ts` implementing `getCredentials(): Promise<CredentialConfig | null>`, `saveCredentials(config: CredentialConfig): Promise<void>`, `isAvailable(): Promise<boolean>` using `keytar` with service name `incident-pal` and accounts `anthropic-api-key` / `aws-profile`; throw typed `KeychainUnavailableError` when keytar fails
- [ ] T010 [P] [US2] Create `src/tui/services/AwsProfileService.ts` using `@aws-sdk/shared-ini-file-loader` `parseKnownFiles()` to return a `string[]` of profile names from `~/.aws/credentials`; return empty array when file absent
- [ ] T011 [P] [US2] Create `src/tui/hooks/useKeychain.ts` — React hook wrapping `KeychainService`; exposes `credentials`, `loading`, `error`, `save(config)` state
- [ ] T012 [P] [US2] Create `src/tui/hooks/useAwsProfiles.ts` — React hook wrapping `AwsProfileService`; exposes `profiles: string[]`, `loading`, `error`
- [ ] T013 [P] [US2] Create `src/tui/components/MaskedInput.tsx` — Ink text input that renders entered characters as `*`; accepts `value`, `onChange`, `placeholder`, `label` props
- [ ] T014 [P] [US2] Create `src/tui/components/AwsProfileSelector.tsx` — keyboard-navigable list of AWS profile names (↑/↓ to move, Enter to select); accepts `profiles: string[]`, `selectedProfile: string | null`, `onSelect` props; shows informative empty state when profiles array is empty
- [ ] T015 [US2] Create `src/tui/screens/SetupWizardScreen.tsx` — two-step wizard: step 1 collects Anthropic API key via `<MaskedInput>` (rejects empty on submit); step 2 selects AWS profile via `<AwsProfileSelector>`; on completion calls `KeychainService.saveCredentials()` and transitions screen state to `investigation-form`
- [ ] T016 [US2] Create `src/tui/screens/SettingsScreen.tsx` — shows current API key (masked) and current AWS profile; allows updating either value via same components as wizard; saves via `KeychainService.saveCredentials()` on confirm; Cancel returns to originating screen without saving
- [ ] T017 [US2] Wire `SetupWizardScreen` and `SettingsScreen` into `App.tsx` router: on mount check `KeychainService.getCredentials()` — if null render `SetupWizardScreen`; add `,` keybinding (global) to navigate to `SettingsScreen` from `investigation-form` and `report-view` states
- [ ] T018 [P] [US2] Unit tests for `KeychainService` in `tests/unit/tui/KeychainService.test.ts`: mock `keytar`; test `getCredentials` returns null when absent, returns config when present; test `saveCredentials` writes both accounts; test `isAvailable` returns false when keytar throws
- [ ] T019 [P] [US2] Unit tests for `SetupWizardScreen` in `tests/unit/tui/SetupWizardScreen.test.tsx` using `ink-testing-library`: test wizard renders step 1 on mount; test empty API key shows error; test step 2 renders profile selector; test successful completion calls `saveCredentials`
- [ ] T020 [US2] Integration test for full credential setup flow in `tests/integration/tui/credential-setup.test.ts`: mock keychain (no stored creds) → verify wizard renders → simulate form completion → verify `saveCredentials` called with correct values → verify App transitions to `investigation-form` state

**Checkpoint**: User Story 2 fully functional and independently testable.

---

## Phase 4: User Story 1 — Start an Investigation via TUI (Priority: P1)

**Goal**: Accept investigation parameters (service, environment, linking keys, time window) via a keyboard-navigable form and transition to the stream view on submit.

**Independent Test**: Launch TUI with valid credentials in keychain → investigation form appears → complete form → agent starts → stream view appears. Run: `npm test -- tests/unit/tui/InvestigationFormScreen.test.tsx && npm run test:integration -- tests/integration/tui/investigation-start.test.ts`

- [ ] T021 [P] [US1] Create `src/tui/components/ConfirmDialog.tsx` — modal overlay with a message and Yes/No options; accepts `message: string`, `onConfirm`, `onCancel` props; Ctrl+C with an active investigation renders this component before aborting
- [ ] T022 [US1] Create `src/tui/screens/InvestigationFormScreen.tsx` — tabbed form with fields: service name (text), environment (select: production/staging/canary), entity-id / http-correlation-id / kafka-message-id (at least one required), optional time window from/to; inline error messages on invalid submit; submit dispatches `InvestigationRequest` and triggers `App.tsx` state transition to `stream-view`
- [ ] T023 [US1] Update `App.tsx` to wire `InvestigationFormScreen` into the `investigation-form` router state; pass `onSubmit` callback that stores the `InvestigationRequest` in App state and transitions to `stream-view`; update `src/tui/index.tsx` headless path to exit code 0 after env var validation (headless does not run a form)
- [ ] T024 [P] [US1] Unit tests for `InvestigationFormScreen` in `tests/unit/tui/InvestigationFormScreen.test.tsx` using `ink-testing-library`: test form renders all fields; test submit with missing required fields shows inline error; test submit with valid fields calls `onSubmit` with correct `InvestigationRequest`
- [ ] T025 [US1] Integration test for investigation start flow in `tests/integration/tui/investigation-start.test.ts`: mock keychain (valid creds) → simulate form submission → verify `InvestigationRequest` constructed correctly → verify App state transitions to `stream-view`

**Checkpoint**: User Story 1 fully functional and independently testable.

---

## Phase 5: User Story 3 — Monitor the Live Event Stream (Priority: P1)

**Goal**: Display each agent trace event in a scrollable, timestamped, colour-coded live stream panel as it is emitted; show a persistent status bar with elapsed time, budget, and iteration count.

**Independent Test**: Run TUI with a mock investigation (canned trace entries at 500ms intervals) → verify each event type appears in stream panel in correct order with label and timestamp → verify status bar updates → verify scroll-back works. Run: `npm test -- tests/unit/tui/StreamViewScreen.test.tsx && npm run test:integration -- tests/integration/tui/stream-view.test.ts`

- [ ] T026 [US3] Create `src/tui/hooks/useInvestigation.ts` — React hook that: accepts `InvestigationRequest` + `CredentialConfig`; constructs `InvestigationAgent` with `onTraceEntry` callback (added in T004); buffers `StreamEntry` items in state array; exposes `entries: StreamEntry[]`, `status`, `budgetPct`, `elapsedMs`, `iteration`, `report`; supports `INCIDENT_PAL_MOCK_AGENT=1` env var to emit canned entries instead of running the real agent
- [ ] T027 [P] [US3] Create `src/tui/components/StreamEntry.tsx` — renders one `StreamEntry` row: timestamp (HH:MM:SS), coloured event-type label, summary text truncated to terminal width; pressing Enter on focused row expands/collapses `detail` payload
- [ ] T028 [P] [US3] Create `src/tui/components/StatusBar.tsx` — fixed bottom bar rendering: elapsed time, scan budget percentage (turns red at ≥ 80%), current iteration count, overall investigation status label
- [ ] T029 [US3] Create `src/tui/screens/StreamViewScreen.tsx` — scrollable list of `<StreamEntry>` components powered by `useInvestigation`; renders `<StatusBar>` at bottom; auto-scrolls to newest entry unless user has scrolled up (↑/↓ keys); renders `<ConfirmDialog>` on Ctrl+C to confirm abort; transitions App state to `report-view` when `useInvestigation` reports completion
- [ ] T030 [US3] Wire `StreamViewScreen` into `App.tsx` router at `stream-view` state; pass stored `InvestigationRequest` and `CredentialConfig` from App state
- [ ] T031 [P] [US3] Unit tests for `StreamViewScreen` in `tests/unit/tui/StreamViewScreen.test.tsx` using `ink-testing-library` with mock `useInvestigation`: test each event type renders with correct label and colour; test status bar updates when budget/elapsed change; test ConfirmDialog appears on Ctrl+C; test auto-scroll behaviour
- [ ] T032 [US3] Integration test for live event stream in `tests/integration/tui/stream-view.test.ts`: use `INCIDENT_PAL_MOCK_AGENT=1` to emit 10 canned entries → verify all 10 appear in stream panel in order → verify status transitions to complete → verify App transitions to `report-view`

**Checkpoint**: User Story 3 fully functional and independently testable.

---

## Phase 6: User Story 4 — View the Completed Investigation Report (Priority: P2)

**Goal**: Display the full investigation report in a scrollable panel when the agent finishes; allow saving to a file via keyboard shortcut; show a status banner explaining early-termination reasons.

**Independent Test**: Pre-load a completed investigation result → verify report panel renders with full Markdown content → verify scroll works → press `s` → verify report file written to current directory. Run: `npm test -- tests/unit/tui/ReportViewScreen.test.tsx && npm run test:integration -- tests/integration/tui/report-view.test.ts`

- [ ] T033 [US4] Create `src/tui/screens/ReportViewScreen.tsx` — renders full Markdown report content with scrollable viewport (↑/↓); shows status banner at top for `timed-out` or `budget-exhausted` investigations; `s` keybinding writes `report-<investigationId>.md` to `process.cwd()` and shows confirmation message with file path; `Esc` or `q` returns to investigation form (clears investigation state)
- [ ] T034 [US4] Wire `ReportViewScreen` into `App.tsx` router at `report-view` state; pass completed `ReportDocument` from `useInvestigation` hook via App state
- [ ] T035 [P] [US4] Unit tests for `ReportViewScreen` in `tests/unit/tui/ReportViewScreen.test.tsx` using `ink-testing-library`: test report content renders; test status banner appears for timed-out and budget-exhausted cases; test `s` key triggers file write and shows confirmation; test file write uses correct file name pattern
- [ ] T036 [US4] Integration test for report display and save in `tests/integration/tui/report-view.test.ts`: pre-load a completed `Investigation` → verify `ReportViewScreen` renders Markdown content → simulate `s` keypress → verify report file written to temp directory with correct content

**Checkpoint**: User Story 4 fully functional and independently testable.

---

## Phase 7: User Story 5 — Configure Investigation Profiles (Priority: P3)

**Goal**: Allow users to save named investigation form presets and recall them to pre-populate the form on subsequent launches.

**Independent Test**: Create a profile → restart TUI → select profile → verify form fields pre-populated → delete profile → verify it no longer appears. Run: `npm test -- tests/unit/tui/InvestigationProfileService.test.ts && npm run test:integration -- tests/integration/tui/profiles.test.ts`

- [ ] T037 [US5] Create `src/tui/services/InvestigationProfileService.ts` — CRUD operations over `~/.incident-pal/profiles.json`: `list(): Promise<InvestigationProfile[]>`, `save(profile: InvestigationProfile): Promise<void>` (atomic write via `.tmp` rename), `delete(id: string): Promise<void>`; reject duplicate `name` values; create directory if absent
- [ ] T038 [US5] Update `src/tui/screens/InvestigationFormScreen.tsx` to add a profile selector above the form fields (loads profiles via a `useProfiles` hook backed by `InvestigationProfileService`); selecting a profile pre-populates all available fields; add a "Save as profile" action on the form that prompts for a profile name then calls `InvestigationProfileService.save()`; update `tests/unit/tui/InvestigationFormScreen.test.tsx` with profile selector tests
- [ ] T039 [P] [US5] Unit tests for `InvestigationProfileService` in `tests/unit/tui/InvestigationProfileService.test.ts`: mock filesystem; test `list` returns empty array when file absent; test `save` writes atomic JSON; test `save` rejects duplicate names; test `delete` removes correct entry
- [ ] T040 [US5] Integration test for investigation profile CRUD in `tests/integration/tui/profiles.test.ts`: save a profile → list → verify appears → delete → list → verify absent; test duplicate name rejection

**Checkpoint**: User Story 5 fully functional. All five user stories independently testable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Robustness, developer ergonomics, and final quality gates.

- [ ] T041 Add minimum terminal dimensions check to `src/tui/index.tsx`: before starting Ink app check `process.stdout.columns` and `process.stdout.rows`; if below 80×24 show warning message and exit with code 3
- [ ] T042 [P] Add graceful terminal resize handler to `src/tui/App.tsx`: listen for `SIGWINCH`; call Ink's `rerender` to reflow layout within 500ms
- [ ] T043 [P] Verify `INCIDENT_PAL_MOCK_AGENT=1` mock mode in `useInvestigation.ts` emits all seven trace event types (tool-call, tool-result, tool-error, linking-key-discovered, result-truncated, budget-exhausted, timed-out) with representative payloads for local development and testing
- [ ] T044 Run `npm run typecheck` across both `tsconfig.json` and `tsconfig.tui.json`; fix all type errors in `src/tui/`
- [ ] T045 Run `npm run lint`; fix all ESLint warnings and errors in `src/tui/`, `tests/unit/tui/`, `tests/integration/tui/`
- [ ] T046 Run `npm test && npm run test:integration && npm run eval:structural`; fix any failures and confirm all quality gates green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 completion — **BLOCKS all user stories**
- **Phase 3 (US2 — Credentials)**: Depends on Phase 2 — must complete before Phase 4
- **Phase 4 (US1 — Form)**: Depends on Phase 2 + Phase 3 (keychain credential retrieval needed)
- **Phase 5 (US3 — Stream)**: Depends on Phase 4 (agent must be startable via form)
- **Phase 6 (US4 — Report)**: Depends on Phase 5 (investigation must be able to complete)
- **Phase 7 (US5 — Profiles)**: Depends on Phase 4 (extends the investigation form) — independent of Phases 5–6
- **Phase 8 (Polish)**: Depends on all user story phases complete

### User Story Dependencies

- **US2 (Credentials)**: Can start after Foundational — no story dependencies
- **US1 (Form)**: Requires US2 complete (credential check on launch determines form vs wizard)
- **US3 (Stream)**: Requires US1 complete (stream view is the post-form transition target)
- **US4 (Report)**: Requires US3 complete (report view is the post-stream transition target)
- **US5 (Profiles)**: Requires US1 complete (extends the form); independent of US2–US4

### Within Each Phase

- Tasks marked `[P]` within the same phase can run in parallel
- Services before hooks before components before screens
- Unit tests can be written in parallel with implementation for the same story
- Commit after each checkpoint

### Parallel Opportunities

```bash
# Phase 3 (US2) — parallel start:
T009  # KeychainService
T010  # AwsProfileService
T013  # MaskedInput component
T018  # KeychainService unit test (alongside T009)

# Phase 5 (US3) — parallel start:
T027  # StreamEntry component
T028  # StatusBar component
T031  # StreamViewScreen unit test (alongside T029)
```

---

## Parallel Example: User Story 3

```bash
# Launch together (different files, no inter-dependencies):
Task T027: "Create src/tui/components/StreamEntry.tsx"
Task T028: "Create src/tui/components/StatusBar.tsx"
Task T031: "Unit tests for StreamViewScreen in tests/unit/tui/StreamViewScreen.test.tsx"

# Then sequentially:
Task T029: "Create src/tui/screens/StreamViewScreen.tsx" (needs T027 + T028)
Task T030: "Wire StreamViewScreen into App.tsx" (needs T029)
Task T032: "Integration test for live event stream" (needs T030)
```

---

## Implementation Strategy

### MVP First (User Stories 1–3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US2 — Credential Setup
4. Complete Phase 4: US1 — Start Investigation
5. Complete Phase 5: US3 — Live Event Stream
6. **STOP and VALIDATE**: Three P1 stories fully functional end-to-end
7. Demo: `incident-pal tui` → wizard → form → live stream

### Incremental Delivery

1. Setup + Foundational → project builds and CLI accepts `tui` subcommand
2. +US2 → credential wizard works; settings screen works
3. +US1 → investigation form works; agent starts
4. +US3 → live stream visible during investigation (MVP complete!)
5. +US4 → report displayed in-app after investigation
6. +US5 → profiles speed up repeat investigations
7. +Polish → final quality gates green

### Parallel Team Strategy

With multiple developers (after Phase 2 complete):

- **Developer A**: US2 (Credentials) → US1 (Form)
- **Developer B**: US3 (Stream) after US1 merges
- **Developer C**: US5 (Profiles) in parallel after US1 merges

---

## Notes

- `[P]` tasks operate on different files — no merge conflicts when run in parallel
- `[Story]` label maps each task to a specific user story for traceability
- Verify that `onTraceEntry` callback (T004) does not throw into the agent loop — wrap all TUI code called from it in try/catch
- The `INCIDENT_PAL_MOCK_AGENT=1` env var enables local development without live AWS credentials
- Each phase ends with a testable checkpoint; resist moving to the next phase before validating
- Atomic profile file writes (T037) prevent corruption on concurrent access
- `keytar` requires a native rebuild; if `npm install` fails on CI, ensure `libsecret-devel` / Xcode CLT is installed first
