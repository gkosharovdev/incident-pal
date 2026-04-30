# incident-pal — Agent Instructions

Production investigation agent for AWS ECS services. Read this file before making any change.

---

## Essential commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run typecheck    # type-check without emitting (tsc --noEmit)
npm run lint         # ESLint with --max-warnings 0 (must be zero issues)
npm test             # unit tests (no AWS calls, fast)
npm run test:integration  # integration tests (mock clients, no live AWS)
npm run eval:structural   # Tier 1 evals — structural assertions, no LLM, <30 s
npm run eval:accuracy     # Tier 2 evals — golden-set, calls live Anthropic API
```

**All four of `typecheck`, `lint`, `test`, and `test:integration` must pass before any commit.**
`eval:structural` must also pass. `eval:accuracy` runs on merge to main (requires `ANTHROPIC_API_KEY`).

---

## Project layout

```
src/
├── agent/           # ReAct loop, ToolRegistry, prompts, ScanBudget, InvestigationTimer
│   ├── InvestigationAgent.ts   # main orchestrator
│   ├── ToolRegistry.ts         # name → Tool lookup; Open/Closed registration
│   ├── LinkingKeyExtractor.ts  # discovers linking keys from CloudWatch entries
│   ├── ScanBudget.ts           # per-investigation byte budget enforcement
│   ├── InvestigationTimer.ts   # wall-clock timeout (MAX_DURATION_MS)
│   └── prompts.ts              # SYSTEM_PROMPT (cached) + buildInvestigationContext()
├── tools/
│   ├── cloudwatch/             # CloudWatchLogsTool — Logs Insights queries
│   ├── ecs/                    # EcsDeploymentTool — deployment history
│   ├── service-catalog/        # ServiceCatalogTool — resolves log group, cluster, schema
│   ├── customer-correlation/   # CustomerCorrelationTool — entity lookup HTTP client
│   └── extensions/
│       └── notification-outbox/ # NotificationOutboxTool — reference extension template
├── models/          # TypeScript types, Tool interface, Trace, TraceSerializer, Zod validation
├── report/          # ReportRenderer — structured Investigation → Markdown
└── cli/             # CLI entry point (commander)

tests/
├── unit/            # fast, mock tools, no network
└── integration/     # mock AWS/HTTP clients, no live calls

evals/
├── structural/      # Tier 1 — assert shape and behaviour without LLM
├── accuracy/        # Tier 2 — golden-set scenarios with live LLM + fixtures
├── scenarios/       # S001–S010 scenario definitions (JSON)
└── fixtures/        # recorded tool responses per scenario
```

---

## Architecture overview

See [`.specify/memory/architecture.md`](.specify/memory/architecture.md) for the full design narrative.
See [`.specify/memory/constitution.md`](.specify/memory/constitution.md) for non-negotiable constraints.

The short version: `InvestigationAgent` runs a ReAct loop — it sends a context message to Claude, receives tool-use blocks, calls each registered tool, feeds results back, and repeats until Claude calls `produce-report` or a stop condition is hit (max iterations, timeout, budget exhaustion). All tools implement one narrow interface (`src/models/Tool.ts`). Adding a new tool requires zero changes to core agent code.

---

## Key constraints (see constitution for full rules)

- **Read-only**: tools MUST NOT write to any system.
- **Lint must be clean**: `npm run lint` exits 0 with zero warnings.
- **Complexity ≤ 10**: cyclomatic complexity per function, enforced by ESLint.
- **No `any`**: `@typescript-eslint/no-explicit-any` is an error.
- **`unknown | null` → `unknown`**: `unknown` already includes `null`.
- **Tests before merge**: all four quality gates must be green.
- **No `eslint-disable`** comments to silence failures — fix the root cause.

---

## Adding a new tool

1. Create `src/tools/<name>/YourTool.ts` implementing `Tool` from `src/models/Tool.ts`.
2. Add `tests/unit/tools/<name>.test.ts` and `tests/integration/tools/<name>.test.ts`.
3. Add an eval fixture under `evals/scenarios/` and `evals/fixtures/` for at least one scenario.
4. Register it when constructing `InvestigationAgent`:

```typescript
const agent = new InvestigationAgent({
  tools: [
    new CloudWatchLogsTool(cwClient),
    new EcsDeploymentTool(ecsClient),
    new ServiceCatalogTool(catalogPath),
    new YourTool(yourClient),   // ← just add it here
  ],
});
```

No changes to `InvestigationAgent`, `ToolRegistry`, prompts, or any other core file are needed.
See `src/tools/extensions/notification-outbox/NotificationOutboxTool.ts` as a reference.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required |
| `AWS_REGION` | `us-east-1` | |
| `MAX_DURATION_MS` | `600000` | Wall-clock timeout per investigation |
| `MAX_ITERATIONS` | `20` | Max agent loop iterations |
| `SCAN_BUDGET_BYTES` | `1073741824` | Per-investigation CloudWatch scan budget |
| `MAX_RESULTS_PER_QUERY` | `500` | Truncation threshold |
| `SERVICE_CATALOG_PATH` | `./service-catalog.yml` | Path to service catalog YAML |
