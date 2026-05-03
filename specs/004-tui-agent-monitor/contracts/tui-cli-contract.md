# Contract: TUI CLI Interface

**Date**: 2026-05-01 (updated 2026-05-01) | **Branch**: `004-tui-agent-monitor`

---

## Overview

The TUI is invoked as a subcommand of the existing `incident-pal` CLI binary. It adds one new subcommand (`tui`) and one new global flag (`--headless`). All existing subcommands and flags are unchanged.

---

## Command Schema

### `incident-pal tui`

Launch the interactive terminal UI.

```
incident-pal tui [options]
```

**Options**:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--headless` | `boolean` | `false` | Force headless mode. Bypasses all interactive prompts. Credentials must be supplied via env vars. |

**Behaviour**:

1. If `--headless` is set **or** `process.stdout.isTTY` is falsy → headless mode:
   - Read `ANTHROPIC_API_KEY` from environment. If absent → exit code 1, error to stderr.
   - Read `AWS_PROFILE` from environment. If absent → exit code 1, error to stderr.
   - No Ink app is started. Print confirmation message to stdout and exit code 0.
   - **Design note**: `incident-pal tui --headless` is a credential-validation command only. It confirms that the required environment variables are present and correctly named before a pipeline runs. To run an investigation non-interactively, use the existing `incident-pal investigate` subcommand (which reads the same env vars and needs no TUI). This separation keeps the TUI's responsibility narrow and the `investigate` subcommand composable in scripts.
2. If interactive mode:
   - Check OS keychain for `incident-pal / anthropic-api-key` and `incident-pal / aws-profile`.
   - If either is missing → start `SetupWizardScreen`.
   - Otherwise → start `InvestigationFormScreen`.

**Exit codes**:

| Code | Meaning |
|------|---------|
| `0` | Normal exit (user quit TUI, investigation complete, or headless validation passed) |
| `1` | Missing required env var in headless mode |
| `2` | OS keychain unavailable (interactive mode only; user is shown error screen and exits) |

---

## Keychain Service Contract

The `KeychainService` is the single point of access for all keychain operations. No other module calls `keytar` directly.

**Service name**: `incident-pal` (used as `keytar` service identifier for all entries)

**Accounts**:

| Account key | Contents |
|-------------|----------|
| `anthropic-api-key` | Anthropic API key string |
| `aws-profile` | Selected AWS named profile string |

**Interface**:

```
KeychainService
  getCredentials(): Promise<CredentialConfig | null>
    // Returns null if either account is absent from keychain
  saveCredentials(config: CredentialConfig): Promise<void>
    // Overwrites both accounts; rejects if keychain unavailable
  isAvailable(): Promise<boolean>
    // Returns false if keytar throws on a probe get
```

**Error behaviour**:
- If `keytar` throws (keychain locked, daemon unavailable), `KeychainService` wraps the error and throws a typed `KeychainUnavailableError`.
- Callers catch `KeychainUnavailableError` and show the user the "keychain unavailable" error screen with env-var fallback instructions.

---

## InvestigationAgent Event Streaming Contract

The additive change to `InvestigationAgentConfig`:

```
InvestigationAgentConfig (existing interface, field added)
  onTraceEntry?: (entry: TraceEntry) => void
    // Called synchronously after each TraceEntry is appended to the Trace.
    // Must not throw — exceptions are caught and logged but do not interrupt
    // the investigation loop.
    // Optional. If absent, behaviour is identical to before this change.
```

**Invocation point**: inside `InvestigationAgent.recordToolResult()`, immediately after `state.trace.appendEntry(entry)`.

**Guarantee**: called for every entry type — `tool-call`, `tool-error`, `linking-key-discovered`, `result-truncated`, `budget-exhausted`, `timed-out`.

---

## Profile Storage Contract

**File**: `~/.incident-pal/profiles.json`

**Format**:
```json
[
  {
    "id": "uuid-v4",
    "name": "my-service-prod",
    "serviceId": "my-service",
    "environment": "production",
    "defaultLinkingKeyPrefix": "order:",
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-05-01T10:00:00.000Z"
  }
]
```

**Rules**:
- File is valid JSON at all times. Writes are atomic (write to `.tmp`, then rename).
- Missing file is treated as empty array (no profiles).
- Corrupt file causes a parse error displayed to the user; no auto-repair.
- Profile `name` uniqueness is enforced at the application layer, not via file locking.
