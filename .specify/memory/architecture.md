# Architecture: incident-pal

**Version**: 1.0.0 | **Date**: 2026-04-30

---

## Purpose

incident-pal is a ReAct (Reason + Act) agent that autonomously investigates production incidents on AWS ECS services. Given a service name, environment, and at least one linking key (entity ID, HTTP correlation ID, or Kafka message ID), it queries registered data sources, discovers new linking keys, forms hypotheses, and renders a structured Markdown report.

---

## High-level flow

```
CLI / library caller
        │
        ▼
InvestigationAgent.investigate(request)
        │
        ├─ applyDefaultTimeWindow()      ← 60-min default if omitted
        ├─ create SessionState           ← investigationId, Trace, LinkingKeySet, ScanBudget, InvestigationTimer
        │
        └─ ReAct loop (while iterations < max && !timedOut && !budgetExhausted)
                │
                ├─ POST messages → Anthropic claude-sonnet-4-6
                │       system: SYSTEM_PROMPT (prompt-cached, ephemeral)
                │       tools:  all registered tool definitions
                │
                ├─ stop_reason == "end_turn"  → break
                ├─ stop_reason == "tool_use"  → processToolUseBlocks()
                │       │
                │       ├─ for each ToolUseBlock:
                │       │       ├─ guard: timer expired?    → timed-out TraceEntry, break
                │       │       ├─ guard: tool not found?   → tool-unavailable TraceEntry
                │       │       ├─ guard: budget exhausted? → budget-exhausted TraceEntry
                │       │       ├─ tool.invoke(input)       → ToolResult
                │       │       ├─ recordToolResult()       → TraceEntry (tool-call | tool-error | result-truncated)
                │       │       └─ postProcessToolResult()
                │       │               ├─ "cloudwatch-logs" → LinkingKeyExtractor → linking-key-discovered TraceEntries
                │       │               └─ "produce-report"  → extract hypotheses + evidence
                │       │
                │       └─ push tool_result messages back to conversation
                │
                └─ buildInvestigation()
                        ├─ determine status (complete | timed-out | budget-exhausted)
                        ├─ build ReportMetadata
                        └─ ReportRenderer.render() → Report (markdownContent + structured data)
```

---

## Core components

### InvestigationAgent (`src/agent/InvestigationAgent.ts`)

Owns the ReAct loop. Stateless between investigations — all mutable state lives in `SessionState` (a plain object created per call). Uses `SessionState` to thread state through helper methods without passing many individual arguments.

Key methods beyond `investigate()`:

| Method | Responsibility |
|---|---|
| `processToolUseBlocks()` | Iterates tool-use blocks; short-circuits on timeout |
| `processSingleToolUse()` | Guards (timer, registry, budget) then delegates to `invokeAndRecordTool()` |
| `invokeAndRecordTool()` | Calls `tool.invoke()`, catches errors, records TraceEntry |
| `recordToolResult()` | Updates budget, marks truncation, appends trace entry |
| `postProcessToolResult()` | CloudWatch → key discovery; produce-report → hypothesis/evidence extraction |
| `discoverLinkingKeys()` | Runs `LinkingKeyExtractor` and appends `linking-key-discovered` entries |
| `buildInvestigation()` | Assembles final `Investigation` object and calls `ReportRenderer` |

### ToolRegistry (`src/agent/ToolRegistry.ts`)

Map of `name → Tool`. Registration happens at construction time — the agent iterates over the `tools` array in `InvestigationAgentConfig` and calls `register()`. `getToolDefinitions()` returns the Anthropic-shaped `{ name, description, input_schema }` array passed to the API on every iteration.

**This is the Open/Closed boundary.** Extending the agent with a new data source means registering a new tool here; it never means editing `InvestigationAgent`.

### Tool interface (`src/models/Tool.ts`)

```typescript
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema7;
  invoke(input: unknown): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  data: unknown;
  error: string | null;
  scanBytesUsed?: number;   // set by log-query tools for budget tracking
  truncated?: boolean;      // set when result-count threshold was hit
}
```

Every tool — built-in or extension — implements this interface. No other contract exists.

### LinkingKeyExtractor (`src/agent/LinkingKeyExtractor.ts`)

After every successful `cloudwatch-logs` call, the agent runs the extractor over the returned entries. It uses a per-log-group schema (field name → linking key type) to extract entity IDs, HTTP correlation IDs, and Kafka message IDs from JSON log entries. Newly discovered keys are added to `activeLinkingKeys` and recorded as `linking-key-discovered` trace entries, making them available for subsequent queries.

Default schema (applied when no service-specific schema is registered):

```
orderId, customerId, paymentId  → entity-id
traceId, correlationId          → http-correlation
messageId, kafkaMessageId       → kafka-message-id
```

### ScanBudget (`src/agent/ScanBudget.ts`)

Per-investigation byte counter. Each `cloudwatch-logs` result carries a `scanBytesUsed` estimate. Once `budget.isExhausted` is true, all further tool calls (except `produce-report`) are blocked and return a `budget-exhausted` result. Default: 1 GB (`SCAN_BUDGET_BYTES`).

### InvestigationTimer (`src/agent/InvestigationTimer.ts`)

Wall-clock timeout. Checked before each iteration and between each tool-use block. On expiry, sets `state.timedOut = true` and appends a `timed-out` TraceEntry. Default: 10 minutes (`MAX_DURATION_MS`).

### Trace (`src/models/Trace.ts`)

Append-only audit log. `appendEntry()` deep-freezes each entry before storing it — entries are immutable once written. `TraceSerializer` converts a `Trace` to a versioned JSON format written to `./traces/<id>.json` by the CLI.

### ReportRenderer (`src/report/ReportRenderer.ts`)

Converts a completed `Investigation` + collected `evidenceBySource` + `ReportMetadata` into a `Report` struct. The struct contains both structured fields (for programmatic use) and `markdownContent` (for human consumption). Sections are rendered by separate private methods (`renderSummaryLines`, `renderEvidenceLines`, etc.) to keep cyclomatic complexity under 10.

---

## Built-in tools

| Tool | File | What it queries |
|---|---|---|
| `cloudwatch-logs` | `src/tools/cloudwatch/CloudWatchLogsTool.ts` | CloudWatch Logs Insights — structured log queries |
| `ecs-deployment` | `src/tools/ecs/EcsDeploymentTool.ts` | ECS service deployment history within the time window |
| `service-catalog` | `src/tools/service-catalog/ServiceCatalogTool.ts` | Static YAML catalog — resolves log group, cluster, linking key schema |
| `customer-correlation` | `src/tools/customer-correlation/CustomerCorrelationTool.ts` | Internal HTTP API — entity lookups by ID |

---

## Extension model

Extension tools live under `src/tools/extensions/`. They are **not** imported by the core — they are registered by the caller:

```typescript
import { NotificationOutboxTool } from "incident-pal/tools/extensions/notification-outbox";

const agent = new InvestigationAgent({
  tools: [
    new CloudWatchLogsTool(cwClient),
    new EcsDeploymentTool(ecsClient),
    new ServiceCatalogTool(catalogPath),
    new NotificationOutboxTool(httpClient, "https://outbox.internal"),
  ],
});
```

### Checklist for a new extension tool

1. Create `src/tools/extensions/<name>/YourTool.ts` — implement `Tool`.
2. Write `tests/unit/tools/<name>.test.ts` — mock the underlying client.
3. Write `tests/integration/extensions/<name>.test.ts` — verify registry integration.
4. Add `evals/scenarios/S0NN-<name>.json` + `evals/fixtures/<name>/` — at least one golden-set scenario.
5. Register in your application's `InvestigationAgent` constructor.

No changes to any file under `src/agent/` or `src/models/` are needed or permitted (see constitution §VI).

### What makes a good tool

- **Narrow input schema**: only the fields the LLM needs to call it. Avoid optional fields unless genuinely optional.
- **Structured output**: return typed JSON the LLM can reason over. Avoid free-form strings.
- **Set `scanBytesUsed`** if the tool scans log or event data — this feeds into `ScanBudget`.
- **Set `truncated: true`** if results were capped — this surfaces a warning in the report.
- **Never write**: the `invoke` method must be side-effect free (constitution §I).
- **Handle errors gracefully**: return `{ success: false, data: null, error: "..." }` rather than throwing — the agent will record a `tool-error` trace entry and continue.

---

## Prompt caching

`SYSTEM_PROMPT` is sent with `cache_control: { type: "ephemeral" }` on every API call. Because the system prompt is static across all iterations of a single investigation (and across investigations), Anthropic's prompt cache keeps it warm, significantly reducing token cost and latency per iteration. Avoid putting dynamic content in the system prompt — it breaks the cache.

---

## Eval strategy

Two tiers, split by cost:

| Tier | File pattern | When it runs | Uses LLM? |
|---|---|---|---|
| 1 — Structural | `evals/structural/*.eval.ts` | Every PR | No |
| 2 — Accuracy | `evals/accuracy/runner.eval.ts` | Merge to main | Yes (live API) |

Tier 1 evals use mock tools and assert structural properties (trace bookends, report sections, timeout behaviour, budget enforcement, etc.). Tier 2 evals load golden-set scenarios from `evals/scenarios/` with recorded fixtures from `evals/fixtures/`, run the full agent loop, and assert that the report contains correct root-cause keywords and meets the minimum confidence level.

Scenarios span at least three observation types: `notification-failure`, `payment-failure`, `data-discrepancy`, `incorrect-status`, `deployment-impact`.
