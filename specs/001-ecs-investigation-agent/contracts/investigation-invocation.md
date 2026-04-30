# Contract: Investigation Invocation

**Type**: Programmatic API / CLI  
**Version**: 1.0.0  
**Date**: 2026-04-30

The investigation agent exposes a single invocation contract. It accepts structured inputs and returns a structured result containing the investigation report and trace.

---

## Input Contract

```typescript
interface InvestigationInput {
  /** Service name — must exist in the service catalog */
  serviceId: string;

  /** Target environment */
  environment: "production" | "staging" | "canary";

  /**
   * At least one linking key must be provided.
   * All three types are first-class — any one is sufficient.
   */
  linkingKeys: Array<
    | { type: "entity-id";        entityType: string; value: string }
    | { type: "http-correlation"; value: string }
    | { type: "kafka-message-id"; value: string }
  >;

  /**
   * Time window for the investigation.
   * Defaults to the past 60 minutes if omitted.
   */
  timeWindow?: {
    from: string; // ISO 8601
    to: string;   // ISO 8601
  };

  /**
   * Optional free-text description of the observed problem.
   * When provided, it appears verbatim in the report summary and primes the agent's initial hypothesis.
   * Maximum 500 characters.
   */
  observationDescription?: string;

  /**
   * Optional overrides for investigation limits.
   * Agent uses built-in defaults when omitted.
   */
  options?: {
    /** Maximum number of tool calls before halting (default: 20) */
    maxIterations?: number;
    /** Per-investigation log scan budget in bytes (default: configured at deploy time) */
    scanBudgetBytes?: number;
    /** Maximum results per log query before truncation (default: configured at deploy time) */
    maxResultsPerQuery?: number;
  };
}
```

### Validation Rules

- `serviceId` must resolve in the service catalog. If unknown → error before investigation starts.
- `linkingKeys` must be a non-empty array.
- `timeWindow.from` must be strictly before `timeWindow.to`.
- `timeWindow.to` must not be in the future.
- If `timeWindow` is omitted, the applied default window is documented in the report.

---

## Output Contract

```typescript
interface InvestigationOutput {
  investigationId: string; // UUID

  status: "complete" | "failed" | "budget-exhausted" | "timed-out";

  /** Populated when status is "complete" or "budget-exhausted" */
  report?: {
    markdownContent: string;
    structured: {
      summary: {
        serviceId: string;
        environment: string;
        linkingKeys: LinkingKey[];
        timeWindow: { from: string; to: string };
        defaultWindowApplied: boolean;
      };
      timeline: Array<{
        timestamp: string;
        source: string;
        description: string;
      }>;
      hypotheses: Array<{
        description: string;
        confidence: "high" | "medium" | "low" | "unknown";
        supportingEvidenceCount: number;
        contradictingEvidenceCount: number;
      }>;
      likelyFailurePoint: {
        description: string;
        confidence: "high" | "medium" | "low" | "unknown";
      } | null;
      recommendedActions: string[];
      metadata: {
        toolCallsCount: number;
        dataSourcesQueried: string[];
        dataSourcesUnavailable: string[];
        scanBytesUsed: number;
        scanBudgetBytes: number;
        resultsTruncated: boolean;
        uncertaintyFlags: string[];
      };
    };
  };

  /** Always present — full append-only audit log */
  trace: Array<{
    id: string;
    timestamp: string;
    type: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    durationMs: number;
    scanBytesUsed?: number;
  }>;

  /** Populated when status is "failed" */
  error?: {
    code: string;
    message: string;
  };
}
```

---

## Error Codes

| Code | Meaning |
|---|---|
| `UNKNOWN_SERVICE` | `serviceId` not found in the service catalog |
| `INVALID_LINKING_KEYS` | `linkingKeys` is empty or malformed |
| `INVALID_TIME_WINDOW` | `from` ≥ `to`, or `to` is in the future |
| `NO_EVIDENCE_FOUND` | Investigation completed; no evidence matched the linking keys in any data source |
| `BUDGET_EXHAUSTED` | Scan budget hit before investigation could complete; partial report available |
| `MAX_ITERATIONS_EXCEEDED` | Agent loop hit `maxIterations` limit; partial report available |
| `TIMED_OUT` | Wall-clock timeout (`MAX_DURATION_MS`) exceeded; partial report with `## ⚠️ Investigation Timed Out` warning |
| `AGENT_ERROR` | Unrecoverable internal error during the agent loop |

---

## CLI Usage (illustrative)

```
incident-pal investigate \
  --service order-service \
  --env production \
  --entity-id order:ord-12345 \
  --from 2026-04-30T10:00:00Z \
  --to 2026-04-30T11:00:00Z
```

```
incident-pal investigate \
  --service notification-service \
  --env production \
  --http-correlation-id 8f4d2c1a-9b3e-4f7d-a1c2-3d4e5f6a7b8c
```

The CLI writes the Markdown report to stdout and the JSON trace to a file (`./traces/<investigation-id>.json`) by default.
