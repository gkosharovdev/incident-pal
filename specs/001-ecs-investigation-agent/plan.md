# Implementation Plan: Production Investigation Agent

**Branch**: `001-ecs-investigation-agent` | **Date**: 2026-04-30 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/001-ecs-investigation-agent/spec.md`

## Summary

Build a read-only production investigation agent for AWS ECS services. Engineers provide a service name, environment, at least one linking key (entity ID, HTTP correlation ID, or Kafka message ID), and an optional time window. The agent runs a ReAct loop using Claude Sonnet with structured tool use, correlating evidence via 3 core built-in tools (CloudWatch logs, ECS deployment metadata, customer/entity correlation) plus any registered extensions. It produces a Markdown report with timeline, evidence, hypotheses (with confidence levels), and recommended actions, plus an append-only audit trace. The system is implemented in TypeScript, is fully read-only, and ships with a two-tier eval harness (structural evals + golden-set accuracy evals) that must remain green on every merge. A `NotificationOutboxTool` is bundled as a reference extension implementation to serve as a concrete template for teams building domain-specific tools.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS (22.x)  
**Primary Dependencies**: `@anthropic-ai/sdk` (Claude tool use + prompt caching), `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-ecs`, `zod` (runtime schema validation), `commander` (CLI), `vitest` (test runner + eval harness)  
**Storage**: No persistent storage in v1 — traces written to local JSON files; service catalog as static YAML file  
**Testing**: Vitest for unit tests, integration tests, and eval harness (Tier 1 structural + Tier 2 golden-set accuracy)  
**Target Platform**: Node.js CLI (Linux/macOS); invocable as a library from other TypeScript services  
**Project Type**: CLI + library  
**Performance Goals**: Full investigation completes in under 10 minutes (SC-002); default time window = 60 minutes  
**Constraints**: Read-only production access (constitution I); scan budget enforced per investigation (FR-014); max 20 agent iterations; structured JSON logs assumed (FR-013); TypeScript strict mode, no `any` types (constitution IV)  
**Scale/Scope**: Single-tenant per invocation; 3 core built-in tools + 1 bundled reference extension (NotificationOutboxTool); ≥10 golden-set eval scenarios at launch

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Safety First (read-only) | ✅ PASS | All tools are read-only; safety gate in CI detects write paths |
| II. Tests & Evals Always Green | ✅ PASS | Two-tier eval harness planned; structural evals on every PR; accuracy evals on main |
| III. Clean Code & SOLID | ✅ PASS | Tool interface contract enforces I/D/L; ToolRegistry enables O/C; each module has SRP |
| IV. Language Standards (TypeScript, no Python) | ✅ PASS | TypeScript selected; Python excluded |
| V. Auditability & Reproducibility | ✅ PASS | Append-only Trace entity; trace written after every tool call |
| VI. Extensibility via Narrow Tools | ✅ PASS | Tool interface contract defined; new tools require no core changes |

**Constitution Check: PASS** — no violations. Complexity Tracking table not required.

*Post-Phase 1 re-check*: Design (data model, contracts, project structure) is consistent with all principles. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/001-ecs-investigation-agent/
├── plan.md                              # This file
├── research.md                          # Phase 0 output
├── data-model.md                        # Phase 1 output
├── quickstart.md                        # Phase 1 output
├── contracts/
│   ├── investigation-invocation.md      # Phase 1 output
│   └── tool-interface.md               # Phase 1 output
└── tasks.md                             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── agent/
│   ├── InvestigationAgent.ts    # ReAct loop orchestration
│   ├── prompts.ts               # System prompt + tool description templates
│   └── ToolRegistry.ts          # Tool registration and lookup
├── tools/
│   ├── cloudwatch/
│   │   └── CloudWatchLogsTool.ts
│   ├── ecs/
│   │   └── EcsDeploymentTool.ts
│   ├── service-catalog/
│   │   └── ServiceCatalogTool.ts
│   ├── customer-correlation/
│   │   └── CustomerCorrelationTool.ts
│   └── extensions/
│       └── notification-outbox/
│           └── NotificationOutboxTool.ts   # reference extension template
├── models/
│   ├── Investigation.ts         # Core domain types
│   ├── LinkingKey.ts
│   ├── Trace.ts
│   ├── Report.ts
│   └── Tool.ts                  # Tool interface
├── report/
│   └── ReportRenderer.ts        # Structured intermediate → Markdown
└── cli/
    └── index.ts                 # CLI entrypoint (commander)

tests/
├── unit/
│   ├── agent/
│   └── tools/
└── integration/
    └── tools/                   # Recorded fixture tests

evals/
├── scenarios/                   # Golden-set scenarios (JSON, anonymised)
├── fixtures/                    # Recorded tool responses per scenario
├── structural/                  # Tier 1 structural eval suite
├── accuracy/                    # Tier 2 golden-set accuracy eval suite
└── results/                     # CI artefact output (gitignored)

service-catalog.yml              # Static service registry (v1)
```

**Structure Decision**: Single-package TypeScript project. No monorepo needed for v1 — the agent, tools, and CLI are tightly coupled and ship together. The `src/models/Tool.ts` interface is the extension boundary; splitting into packages is deferred until a second consumer exists.

## Complexity Tracking

> No constitution violations — this table is empty.
