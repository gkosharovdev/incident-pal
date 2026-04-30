# Data Model: Production Investigation Agent

**Feature**: 001-ecs-investigation-agent  
**Date**: 2026-04-30

---

## Core Entities

### InvestigationRequest

Input provided by the engineer to start an investigation.

| Field | Type | Required | Constraints |
|---|---|---|---|
| `serviceId` | `string` | Yes | Must exist in the service catalog |
| `environment` | `Environment` | Yes | One of: `production`, `staging`, `canary` |
| `linkingKeys` | `LinkingKey[]` | Yes | At least one; all three types are first-class |
| `timeWindow` | `TimeWindow` | No | Defaults to past 60 minutes if omitted |
| `observationDescription` | `string` | No | Free-text description of observed problem; max 500 chars; appears verbatim in report |

### LinkingKey (discriminated union)

```
LinkingKey =
  | { type: "entity-id";       entityType: string; value: string }
  | { type: "http-correlation"; value: string }
  | { type: "kafka-message-id"; value: string }
```

Any one linking key is sufficient to start an investigation. Additional linking keys discovered during the investigation are added to the active `LinkingKeySet` and used in subsequent queries.

### TimeWindow

| Field | Type | Constraints |
|---|---|---|
| `from` | `ISO8601 datetime` | Must be before `to` |
| `to` | `ISO8601 datetime` | Must be ≤ now |

Default when omitted: `{ from: now - 60 minutes, to: now }`. The applied window is always recorded in the report.

### Investigation

Represents the runtime state of an ongoing or completed investigation.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Generated at invocation |
| `request` | `InvestigationRequest` | The inputs |
| `status` | `InvestigationStatus` | `running` \| `complete` \| `failed` \| `budget-exhausted` \| `timed-out` |
| `activeLinkingKeys` | `LinkingKeySet` | Grows as new keys are discovered |
| `trace` | `Trace` | Append-only log of all tool calls |
| `hypotheses` | `Hypothesis[]` | Accumulated during the agent loop |
| `report` | `Report \| null` | `null` until investigation completes |
| `startedAt` | `ISO8601 datetime` | |
| `completedAt` | `ISO8601 datetime \| null` | |

**State transitions**:
```
[created] → running → complete
                    → failed         (unrecoverable error)
                    → budget-exhausted (scan budget hit before completion)
```

### Trace

Append-only audit log. Never modified after entries are written.

| Field | Type | Notes |
|---|---|---|
| `investigationId` | `UUID` | Foreign key |
| `entries` | `TraceEntry[]` | Ordered by timestamp |

### TraceEntry

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | |
| `timestamp` | `ISO8601 datetime` | |
| `type` | `TraceEntryType` | See below |
| `toolName` | `string \| null` | Set for `tool-call` entries |
| `input` | `unknown` | Raw tool input (JSON-serialisable) |
| `output` | `unknown \| null` | Raw tool output; `null` if tool errored |
| `error` | `string \| null` | Error message if tool call failed |
| `durationMs` | `number` | Wall-clock duration of the call |
| `scanBytesUsed` | `number \| null` | For log queries only |

```
TraceEntryType =
  | "tool-call"
  | "tool-error"
  | "tool-unavailable"
  | "budget-exhausted"
  | "result-truncated"
  | "unparseable-log-entry"
  | "linking-key-discovered"
  | "hypothesis-formed"
  | "investigation-started"
  | "investigation-complete"
  | "timed-out"
```

### Report

Human-readable Markdown output generated from the structured intermediate representation.

| Field | Type | Notes |
|---|---|---|
| `investigationId` | `UUID` | |
| `summary` | `ReportSummary` | Service, env, linking keys, time window, default window flag |
| `timeline` | `TimelineEvent[]` | Chronological; each event has source, timestamp, description |
| `evidenceBySource` | `Map<ToolName, EvidenceItem[]>` | |
| `hypotheses` | `Hypothesis[]` | Ordered by confidence desc |
| `likelyFailurePoint` | `Hypothesis \| null` | Highest-confidence hypothesis; `null` if uncertain |
| `recommendedActions` | `string[]` | Ordered by priority |
| `metadata` | `ReportMetadata` | Tool calls made, gaps, scan budget usage |
| `markdownContent` | `string` | Final rendered Markdown |

### Hypothesis

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | |
| `description` | `string` | Plain-language failure explanation |
| `confidence` | `Confidence` | `high` \| `medium` \| `low` \| `unknown` |
| `supportingEvidence` | `EvidenceItem[]` | |
| `contradictingEvidence` | `EvidenceItem[]` | |

### EvidenceItem

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | |
| `source` | `ToolName` | Which tool produced this item |
| `timestamp` | `ISO8601 datetime` | Event time (not query time) |
| `description` | `string` | Human-readable summary |
| `rawData` | `unknown` | Original data from tool response |
| `linkingKeys` | `LinkingKey[]` | Linking keys present in this evidence item |

### Tool (interface contract)

All tools — built-in and registered extensions — implement this interface.

| Member | Type | Notes |
|---|---|---|
| `name` | `string` | Unique identifier; used in trace and report |
| `description` | `string` | Shown to the LLM in tool definitions |
| `inputSchema` | `JSONSchema` | Validated before execution |
| `invoke(input)` | `Promise<ToolResult>` | Read-only; MUST NOT write to any system |

### ToolResult

| Field | Type | Notes |
|---|---|---|
| `success` | `boolean` | |
| `data` | `unknown \| null` | Structured output |
| `error` | `string \| null` | Human-readable error if `success === false` |
| `scanBytesUsed` | `number \| null` | For log queries only |
| `truncated` | `boolean` | `true` if result-count threshold was hit |

---

## Enumerations

```
Environment         = "production" | "staging" | "canary"
InvestigationStatus = "running" | "complete" | "failed" | "budget-exhausted" | "timed-out"
Confidence          = "high" | "medium" | "low" | "unknown"
TraceEntryType      = (see above)
```

---

## Validation Rules

- `InvestigationRequest.serviceId` must resolve in the service catalog; if not, reject before creating an `Investigation`.
- `InvestigationRequest.linkingKeys` must contain at least one entry.
- `TimeWindow.from` must be strictly before `TimeWindow.to`.
- `TraceEntry` records are immutable once written.
- `Report` is only generated when `Investigation.status` is `complete` or `budget-exhausted`.
- `Tool.invoke` MUST be idempotent and side-effect free; any tool that attempts a write operation is in violation of the constitution (Safety First principle).
