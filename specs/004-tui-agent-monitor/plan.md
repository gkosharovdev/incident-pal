# Implementation Plan: TUI Agent Monitor

**Branch**: `004-tui-agent-monitor` | **Date**: 2026-05-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-tui-agent-monitor/spec.md`

## Summary

Build an interactive terminal UI (TUI) for incident-pal that guides operators through credential setup on first launch, accepts investigation parameters via a form, streams live agent trace events in real time, and displays the completed investigation report — all without leaving the terminal. The TUI runs in-process alongside the existing `InvestigationAgent` and is wired in as a new `tui` subcommand of the existing CLI. A `--headless` flag (plus TTY-absence detection) disables all interactive prompts so the tool continues to work in CI environments.

---

## Technical Context

**Language/Version**: TypeScript 5.8, strict mode, Node.js ≥ 22 (ESM modules)
**Primary Dependencies**:
  - `ink` v5 — React-based TUI framework (ESM, Node ≥ 20, active maintenance)
  - `react` + `@types/react` — required peer dependency for Ink
  - `keytar` — OS keychain access (macOS Keychain / Linux Secret Service)
  - `@aws-sdk/shared-ini-file-loader` — read `~/.aws/credentials` profile list (already in AWS SDK ecosystem)
  - `ink-text-input` — masked/plain text input field component for Ink
  - `ink-testing-library` — test utility for rendering Ink components in Vitest (dev dependency)
**Storage**: OS keychain (credentials), `~/.incident-pal/profiles.json` (investigation profiles)
**Testing**: Vitest (existing); Ink components testable via `ink-testing-library`
**Target Platform**: macOS and Linux terminals supporting 256-colour ANSI; minimum 80×24 columns/rows
**Project Type**: CLI/TUI application extension (new `tui` subcommand added to existing `commander` CLI)
**Performance Goals**: Stream event display ≤ 1 s latency; TUI input response ≤ 100 ms during 50-event bursts
**Constraints**: TypeScript strict mode, zero ESLint warnings, cyclomatic complexity ≤ 10 per function, no `any` types, no production write paths
**Scale/Scope**: Single-user interactive tool; one investigation active at a time

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Constraint | Status | Notes |
|-----------|--------|-------|
| Read-only production access | ✅ Pass | TUI adds no production write paths. Only writes: local report file export, `~/.incident-pal/profiles.json`, OS keychain |
| All tests must pass | ✅ Pass | New TUI components require unit tests (`ink-testing-library`) and integration tests |
| Clean Code & SOLID | ✅ Pass | TUI modules follow SRP; screen components are composable and independently testable |
| TypeScript strict mode | ✅ Pass | Separate `tsconfig.tui.json` extends root tsconfig, adds `"jsx": "react-jsx"` |
| Lint zero warnings | ✅ Pass | ESLint config covers `src/**`; TUI source lives under `src/tui/` |
| New tool requires unit + integration test | ✅ Pass | No new `Tool` implementations in this feature |
| Core agent file modification | ⚠️ Flagged | One additive change to `InvestigationAgentConfig` (see Complexity Tracking) |

---

## Project Structure

### Documentation (this feature)

```text
specs/004-tui-agent-monitor/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── tui-cli-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
src/
├── agent/
│   └── InvestigationAgent.ts      # MODIFIED: add optional onTraceEntry callback to config
├── tools/                         # unchanged
├── models/                        # unchanged
├── report/                        # unchanged
├── cli/
│   └── index.ts                   # MODIFIED: add `tui` subcommand
└── tui/
    ├── index.tsx                  # TUI entry point; detects headless, starts Ink app
    ├── App.tsx                    # Root component; screen router state machine
    ├── screens/
    │   ├── SetupWizardScreen.tsx  # First-launch credential wizard
    │   ├── InvestigationFormScreen.tsx  # Service/env/linking-key form
    │   ├── StreamViewScreen.tsx   # Live trace event feed
    │   ├── ReportViewScreen.tsx   # Completed report viewer
    │   └── SettingsScreen.tsx     # Credential update screen
    ├── components/
    │   ├── StatusBar.tsx          # Persistent bottom bar (timer, budget, status)
    │   ├── StreamEntry.tsx        # Single trace event row renderer
    │   ├── ConfirmDialog.tsx      # Confirmation prompt (e.g., abort investigation)
    │   ├── MaskedInput.tsx        # Password-style masked text input
    │   └── AwsProfileSelector.tsx # Dropdown-style AWS profile picker
    ├── hooks/
    │   ├── useInvestigation.ts    # Agent lifecycle: start, stream, complete
    │   ├── useKeychain.ts         # Read/write credentials via keytar
    │   ├── useAwsProfiles.ts      # Load profile names from ~/.aws/credentials
    │   └── useProfiles.ts         # CRUD state wrapper for InvestigationProfileService
    └── services/
        ├── KeychainService.ts     # OS keychain access (keytar wrapper)
        ├── AwsProfileService.ts   # Parse profile names from ~/.aws/credentials
        └── InvestigationProfileService.ts  # CRUD for ~/.incident-pal/profiles.json

tests/
├── unit/
│   └── tui/                       # Ink component unit tests (ink-testing-library)
└── integration/
    └── tui/                       # Integration tests (mock keychain + mock agent)

tsconfig.tui.json                  # Extends tsconfig.json; adds "jsx": "react-jsx"
```

**Structure Decision**: Single-project extension. The TUI lives under `src/tui/` as a sibling to existing modules. A separate `tsconfig.tui.json` handles React JSX compilation without altering the base tsconfig that governs core agent code. The `tui` build output lands in `dist/tui/` and is referenced by the existing CLI binary.

---

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Additive change to `InvestigationAgentConfig` in `src/agent/InvestigationAgent.ts` — add optional `onTraceEntry?: (entry: TraceEntry) => void` callback | The TUI must receive each trace entry as it is recorded to stream events in real time. No existing hook exists. | Polling the `Trace` object at high frequency (e.g., 100ms) would miss sub-interval events and add unnecessary CPU overhead. A wrapper/subclass approach is blocked by private methods. The callback is purely observational, additive, and backward-compatible — all existing callers pass `undefined` by omission. This is observability infrastructure, not a new data source, and does not violate the spirit of §VI. Pre-implementation note: document this deviation as a formal rationale for the PR review (satisfies amendment governance requirements per §VI). |
| `tsconfig.tui.json` alongside root `tsconfig.json` | Ink requires `"jsx": "react-jsx"` which conflicts with the root `"module": "Node16"` + no-JSX config | A single tsconfig cannot serve both Node16 module resolution for agent code and React JSX transform for TUI components without broader tsconfig changes that would risk breaking existing builds. |
