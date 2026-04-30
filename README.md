# incident-pal

Production investigation agent for AWS ECS services. Given a service name, environment, and at least one linking key (entity ID, HTTP correlation ID, or Kafka message ID), it autonomously queries CloudWatch logs, ECS deployment metadata, and registered data sources to produce a Markdown investigation report with a timeline, evidence, hypotheses, confidence levels, and recommended actions.

---

## Installation

**Prerequisites**: Node.js ≥ 22, AWS credentials with read-only permissions, an `ANTHROPIC_API_KEY`.

```bash
npm install
```

---

## Quickstart

```bash
# Investigate by entity ID
npx incident-pal investigate \
  --service order-service \
  --env production \
  --entity-id order:ord-12345

# Investigate by HTTP correlation ID (defaults to past 60 minutes when no --from/--to given)
npx incident-pal investigate \
  --service notification-service \
  --env production \
  --http-correlation-id 8f4d2c1a-9b3e-4f7d-a1c2-3d4e5f6a7b8c

# Investigate by Kafka message ID with an observation description
npx incident-pal investigate \
  --service dispatch-service \
  --env production \
  --kafka-message-id abc123def456 \
  --description "Dispatch message not acknowledged downstream"

# Narrow the time window explicitly
npx incident-pal investigate \
  --service payment-service \
  --env production \
  --entity-id order:ord-99999 \
  --from 2026-04-30T10:00:00Z \
  --to 2026-04-30T11:00:00Z \
  --description "Payment for ord-99999 was not processed"
```

The Markdown report is written to **stdout**. The full JSON audit trace is written to `./traces/<investigation-id>.json`.

---

## Running Tests

```bash
# Unit tests (no AWS calls, fast)
npm test

# Integration tests (uses mock clients, no live AWS calls)
npm run test:integration

# Structural evals — Tier 1 (no LLM calls, runs in <30s, run on every PR)
npm run eval:structural

# Golden-set accuracy evals — Tier 2 (calls live Anthropic API, run on merge to main)
npm run eval:accuracy

# TypeScript type check
npm run typecheck

# Lint
npm run lint
```

All tests and evals must pass before merging (see [constitution](.specify/memory/constitution.md)).

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `AWS_REGION` | Yes | `us-east-1` | AWS region for CloudWatch and ECS |
| `AWS_ACCESS_KEY_ID` | Yes* | — | AWS credentials (*or use IAM role) |
| `AWS_SECRET_ACCESS_KEY` | Yes* | — | AWS credentials (*or use IAM role) |
| `MAX_DURATION_MS` | No | `600000` | Wall-clock timeout per investigation (ms) |
| `MAX_ITERATIONS` | No | `20` | Max agent loop iterations |
| `SCAN_BUDGET_BYTES` | No | `1073741824` | Per-investigation log scan budget (bytes) |
| `MAX_RESULTS_PER_QUERY` | No | `500` | Result-count truncation threshold |
| `SERVICE_CATALOG_PATH` | No | `./service-catalog.yml` | Path to service catalog YAML |

---

## Project Structure

```
src/
├── agent/          # ReAct loop (InvestigationAgent), ToolRegistry, prompts, ScanBudget, InvestigationTimer
├── tools/
│   ├── cloudwatch/       # CloudWatchLogsTool (core)
│   ├── ecs/              # EcsDeploymentTool (core)
│   ├── service-catalog/  # ServiceCatalogTool (core)
│   ├── customer-correlation/ # CustomerCorrelationTool (core)
│   └── extensions/
│       └── notification-outbox/ # NotificationOutboxTool (reference extension template)
├── models/         # TypeScript types, Tool interface, Trace, TraceSerializer, Zod validation
├── report/         # ReportRenderer (structured → Markdown)
└── cli/            # CLI entrypoint (commander)

tests/
├── unit/           # Unit tests (mock tools, no AWS calls)
└── integration/    # Integration tests (mock clients, no live calls)

evals/
├── structural/     # Tier 1 structural evals (fast, no LLM calls)
├── accuracy/       # Tier 2 golden-set accuracy evals (live LLM + fixtures)
├── scenarios/      # Golden-set scenario definitions (S001–S010)
└── fixtures/       # Recorded tool responses per scenario
```

---

## Adding a New Tool

1. Create `src/tools/<your-tool>/YourTool.ts` implementing the `Tool` interface.
2. Add a unit test at `tests/unit/tools/<your-tool>.test.ts`.
3. Add an integration test at `tests/integration/tools/<your-tool>.test.ts`.
4. Add an eval fixture in `evals/scenarios/` and `evals/fixtures/` covering at least one scenario.
5. Register your tool when constructing `InvestigationAgent`:

```typescript
const agent = new InvestigationAgent({
  tools: [
    ...coreTools,
    new YourTool(yourClient),
  ],
});
```

No changes to core agent code are needed. See [contracts/tool-interface.md](specs/001-ecs-investigation-agent/contracts/tool-interface.md) for the full interface contract, and [src/tools/extensions/notification-outbox/NotificationOutboxTool.ts](src/tools/extensions/notification-outbox/NotificationOutboxTool.ts) for a reference implementation.

---

## Full Documentation

- [Feature Specification](specs/001-ecs-investigation-agent/spec.md)
- [Implementation Plan](specs/001-ecs-investigation-agent/plan.md)
- [Data Model](specs/001-ecs-investigation-agent/data-model.md)
- [Tool Interface Contract](specs/001-ecs-investigation-agent/contracts/tool-interface.md)
- [Investigation Invocation Contract](specs/001-ecs-investigation-agent/contracts/investigation-invocation.md)
- [Quickstart (detailed)](specs/001-ecs-investigation-agent/quickstart.md)
- [Project Constitution](.specify/memory/constitution.md)
