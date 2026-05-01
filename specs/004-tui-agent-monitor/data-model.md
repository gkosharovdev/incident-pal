# Data Model: TUI Agent Monitor

**Date**: 2026-05-01 | **Branch**: `004-tui-agent-monitor`

---

## Entities

### CredentialConfig

Represents the credentials required to run the agent. Stored in the OS keychain — never written to disk as plaintext. In headless mode, sourced from environment variables instead.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `anthropicApiKey` | `string` | Yes | Stored under keychain service `incident-pal`, account `anthropic-api-key` |
| `awsProfile` | `string` | Yes | Named profile from `~/.aws/credentials`. Stored under keychain service `incident-pal`, account `aws-profile` |

**Validation rules**:
- `anthropicApiKey` must be non-empty. The TUI does not validate key format — invalid keys produce agent-level errors at runtime.
- `awsProfile` must be non-empty and must exist in `~/.aws/credentials` at the time of selection.

**Lifecycle**:
- **Created**: during first-launch setup wizard (written to OS keychain)
- **Updated**: via Settings screen (overwrites keychain entry)
- **Read**: at TUI startup to determine whether to show wizard; at investigation start to inject into agent config
- **Deleted**: not supported in v1 (user can clear via OS keychain tools)

**Headless fallback**: when no TTY or `--headless` flag, `ANTHROPIC_API_KEY` and `AWS_PROFILE` env vars are used directly. Keychain is not accessed.

---

### InvestigationProfile

A named, persisted set of investigation form defaults for frequent reuse.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` (UUID v4) | Yes | Generated at creation |
| `name` | `string` | Yes | Display name; max 64 chars; unique across all profiles |
| `serviceId` | `string` | Yes | Pre-fills "Service" field |
| `environment` | `"production" \| "staging" \| "canary"` | Yes | Pre-fills "Environment" field |
| `defaultLinkingKeyPrefix` | `string` | No | Optional hint shown in linking-key field |
| `createdAt` | `string` (ISO 8601) | Yes | Set at creation, immutable |
| `updatedAt` | `string` (ISO 8601) | Yes | Updated on each save |

**Validation rules**:
- `name` must be unique. Duplicate names are rejected at save time.
- `serviceId` and `environment` must be non-empty.
- `environment` must be one of the three allowed values.

**Storage**: `~/.incident-pal/profiles.json` — a JSON array of `InvestigationProfile` objects. File is created on first profile save. Directory `~/.incident-pal/` is created if absent.

**Lifecycle**:
- **Created**: user saves form values with a profile name
- **Read**: listed in profile selector on the investigation form screen
- **Updated**: user edits and re-saves an existing profile
- **Deleted**: user removes a profile from the selector

---

### StreamEntry

A single displayable event in the live stream panel. Derived from a `TraceEntry` at display time — not persisted separately.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | Yes | Matches source `TraceEntry` id |
| `timestamp` | `Date` | Yes | Wall-clock time the entry was recorded |
| `eventType` | `StreamEventType` | Yes | See enum below |
| `label` | `string` | Yes | Short human-readable label (e.g., "Tool Call", "Key Found") |
| `summary` | `string` | Yes | One-line description; truncated to terminal width minus label width |
| `detail` | `unknown` | No | Full payload available via expand shortcut |

**StreamEventType enum** (maps 1:1 to `TraceEntry` types):

| Value | Source TraceEntry type | Display colour |
|-------|----------------------|----------------|
| `tool-call` | `tool-call` | Cyan |
| `tool-result` | `tool-call` (success) | Green |
| `tool-error` | `tool-error` | Red |
| `key-discovered` | `linking-key-discovered` | Yellow |
| `result-truncated` | `result-truncated` | Orange |
| `budget-exhausted` | `budget-exhausted` | Red bold |
| `timed-out` | `timed-out` | Red bold |

---

### TuiConfig

Global TUI configuration, not user-editable directly (derived from environment and CLI flags).

| Field | Type | Notes |
|-------|------|-------|
| `headless` | `boolean` | True when no TTY attached or `--headless` flag passed |
| `minTerminalCols` | `number` | Constant: 80 |
| `minTerminalRows` | `number` | Constant: 24 |

---

## State Transitions

### Screen Router State Machine

```
          ┌─────────────────────────────────────────────┐
          │             TUI starts                      │
          └────────────────────┬────────────────────────┘
                               │
               credentials in keychain?
               ┌───────────────┴────────────────┐
               │ No                             │ Yes
               ▼                               ▼
       SetupWizardScreen              InvestigationFormScreen
               │                               │
       wizard complete              user submits form
               │                               │
               └──────────────┬────────────────┘
                              │
                              ▼
                       StreamViewScreen
                    (investigation running)
                              │
                    investigation finishes
                              │
                              ▼
                       ReportViewScreen
                    (report displayed)

  SettingsScreen — accessible at any time via keyboard shortcut
                   from InvestigationFormScreen or ReportViewScreen;
                   returns to the originating screen on save/cancel
```

---

## Relationships

```
InvestigationProfile  ──(pre-fills)──▶  InvestigationRequest (existing model)
CredentialConfig      ──(injected into)──▶  InvestigationAgentConfig (existing model)
TraceEntry (existing) ──(mapped to)──▶  StreamEntry
```

No new relationships are introduced to the existing agent data model. The TUI entities are all UI/presentation layer — they reference but do not extend core agent models.
