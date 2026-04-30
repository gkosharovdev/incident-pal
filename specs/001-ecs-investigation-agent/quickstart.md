# Quickstart: Production Investigation Agent

**For**: Engineers building or extending the agent  
**Date**: 2026-04-30

---

## Prerequisites

- Node.js (latest LTS)
- AWS credentials with read-only permissions (see IAM section below)
- An `ANTHROPIC_API_KEY` environment variable

---

## Project Structure

```text
incident-pal/
├── src/
│   ├── agent/               # LLM orchestration (ReAct loop, prompt templates)
│   ├── tools/               # Narrow read-only tool implementations
│   │   ├── cloudwatch/
│   │   ├── ecs/
│   │   ├── outbox/
│   │   ├── email-delivery/
│   │   ├── service-catalog/
│   │   └── customer-correlation/
│   ├── models/              # TypeScript types (data model)
│   ├── report/              # Report rendering (structured → Markdown)
│   └── cli/                 # CLI entrypoint
├── tests/
│   ├── unit/                # Unit tests (mock tools, no AWS calls)
│   └── integration/         # Integration tests (recorded fixtures)
├── evals/
│   ├── scenarios/           # Golden-set incident scenarios (anonymised)
│   ├── fixtures/            # Recorded tool responses per scenario
│   └── results/             # CI artefact output (gitignored)
├── contracts/               # (this repo) Interface specs — see contracts/
└── specs/                   # (this repo) Feature specs — see specs/
```

---

## Running an Investigation (CLI)

```bash
# Install dependencies
npm install

# Investigate by entity ID
npx incident-pal investigate \
  --service order-service \
  --env production \
  --entity-id order:ord-12345 \
  --from 2026-04-30T10:00:00Z \
  --to 2026-04-30T11:00:00Z

# Investigate by HTTP correlation ID (no time window — defaults to past 60 min)
npx incident-pal investigate \
  --service notification-service \
  --env production \
  --http-correlation-id 8f4d2c1a-9b3e-4f7d-a1c2-3d4e5f6a7b8c

# Investigate by Kafka message ID
npx incident-pal investigate \
  --service dispatch-service \
  --env production \
  --kafka-message-id abc123def456

# Investigate with an observation description (primes the initial hypothesis)
npx incident-pal investigate \
  --service payment-service \
  --env production \
  --entity-id order:ord-12345 \
  --description "Payment for order ord-12345 was not processed"

# --from and --to are optional; when omitted the default is the past 60 minutes
npx incident-pal investigate \
  --service order-service \
  --env production \
  --entity-id order:ord-99999
```

The Markdown report is printed to stdout. The full JSON trace is written to `./traces/<investigation-id>.json`.

---

## Running Tests

```bash
# All unit tests (fast, no AWS calls)
npm test

# Integration tests (uses recorded fixtures, no live AWS calls)
npm run test:integration

# Structural evals (Tier 1 — fast, always run)
npm run eval:structural

# Golden-set accuracy evals (Tier 2 — calls live LLM, uses fixture data)
npm run eval:accuracy
```

All tests and evals must pass before merging. See constitution clause II.

---

## Adding a New Tool

1. Create `src/tools/<your-tool>/index.ts` implementing the `Tool` interface (see `contracts/tool-interface.md`).
2. Add a unit test at `tests/unit/tools/<your-tool>.test.ts`.
3. Add an integration test (or recorded fixture) at `tests/integration/tools/<your-tool>.test.ts`.
4. Register the tool in `src/agent/registry.ts`.
5. Add an eval fixture to `evals/scenarios/` covering at least one scenario that uses the new tool.
6. Run `npm run eval:structural` and `npm run eval:accuracy` — both must pass.

---

## Registering an Extension Tool (e.g. NotificationOutboxTool)

```typescript
import { InvestigationAgent } from "incident-pal";
import { CloudWatchLogsTool } from "incident-pal";
import { EcsDeploymentTool } from "incident-pal";
import { NotificationOutboxTool } from "incident-pal/tools/extensions/notification-outbox";

const agent = new InvestigationAgent({
  tools: [
    new CloudWatchLogsTool(cloudWatchClient),
    new EcsDeploymentTool(ecsClient),
    // Register the reference extension — no core changes needed
    new NotificationOutboxTool(outboxHttpClient, "https://outbox.internal"),
  ],
});
```

All extension tools must implement the `Tool` interface. See `contracts/tool-interface.md` for full requirements.

---

## IAM Permissions Required

The AWS principal running the agent needs the following **read-only** permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "logs:StartQuery",
    "logs:GetQueryResults",
    "logs:DescribeLogGroups",
    "logs:DescribeLogStreams",
    "ecs:ListServices",
    "ecs:DescribeServices",
    "ecs:ListTaskDefinitions",
    "ecs:DescribeTaskDefinition"
  ],
  "Resource": "*"
}
```

No write permissions are granted. The agent will fail the safety gate in CI if any tool call requires write permissions.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `AWS_REGION` | Yes | AWS region for CloudWatch and ECS |
| `AWS_ACCESS_KEY_ID` | Yes* | AWS credentials (*or use IAM role) |
| `AWS_SECRET_ACCESS_KEY` | Yes* | AWS credentials (*or use IAM role) |
| `SCAN_BUDGET_BYTES` | No | Per-investigation scan budget (default: 1 GB) |
| `MAX_RESULTS_PER_QUERY` | No | Result-count truncation threshold (default: 500) |
| `MAX_ITERATIONS` | No | Max agent loop iterations (default: 20) |
| `MAX_DURATION_MS` | No | Wall-clock timeout per investigation in ms (default: 600000 = 10 minutes) |
| `SERVICE_CATALOG_PATH` | No | Path to static service catalog YAML (default: `./service-catalog.yml`) |
