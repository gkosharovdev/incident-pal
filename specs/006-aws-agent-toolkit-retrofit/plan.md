# Implementation Plan: AWS Agent Toolkit Retrofit

**Branch**: `006-aws-agent-toolkit-retrofit` | **Date**: 2026-05-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/006-aws-agent-toolkit-retrofit/spec.md`

---

## Summary

Replace the four custom AWS SDK tool implementations (`CloudWatchLogsTool`, `LogGroupDiscoveryTool`, `EcsDeploymentTool`, `AuroraDbTool`) with thin adapters that delegate AWS API calls to the AWS Agent Toolkit via an MCP connection. A new `AwsToolkitClient` TypeScript class manages the proxy lifecycle and exposes typed methods. All tool adapters keep their existing `name` strings and `Tool` interface contract, so the agent core, registry, prompt, and eval fixtures require zero changes.

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js LTS (current: 22.x)
**Primary Dependencies**: `@anthropic-ai/sdk` (existing), `@modelcontextprotocol/sdk` (new), `zod` (existing)
**Storage**: N/A — read-only agent, no persistence
**Testing**: Vitest (unit + integration); Tier 1 structural evals (no LLM); Tier 2 accuracy evals (live Anthropic API, merge gate only)
**Target Platform**: Linux server (same as today)
**Project Type**: Node.js library + CLI
**Performance Goals**: Investigation end-to-end latency ≤ 120% of pre-migration baseline (SC-003)
**Constraints**: Read-only (§I); TypeScript strict mode, zero `any`, complexity ≤ 10 (§III/§IV); all quality gates green (§II)
**Scale/Scope**: One `AwsToolkitClient` per `InvestigationAgent` instance; 4 tool adapters affected; ~5 source files added, ~3 removed

---

## Constitution Check

*GATE: Must pass before implementation. Re-checked after design.*

| Clause | Status | Notes |
|--------|--------|-------|
| §I Safety (read-only) | PASS | All `aws___call_aws` calls use read-only operations; `aws___run_script` (P3) uses SELECT-only SQL enforced by `AuroraDbGuard` |
| §II Tests always green | PASS | New adapters require unit + integration tests; eval fixtures are unchanged (same tool names) |
| §III SOLID | PASS | Adapters implement `Tool` (Liskov); core unchanged (Open/Closed); `AwsToolkitClient` injected into adapters (Dependency Inversion) |
| §IV TypeScript | CONDITIONAL | `aws___run_script` content for Aurora is a Python string literal in a TypeScript file; no Python toolchain dependency; no `.py` files; see Complexity Tracking |
| §V Auditability | PASS | `ToolResult` shape and `Trace` format unchanged; AWS-side audit via CloudTrail is a bonus |
| §VI Extensibility | PASS | Core files under `src/agent/` and `src/models/` are not modified; `AwsToolkitClient` + adapters are new files only |

---

## Project Structure

### Documentation (this feature)

```text
specs/006-aws-agent-toolkit-retrofit/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit-tasks command)
```

### Source Code Changes

```text
src/tools/
├── aws-toolkit/                          ← NEW directory
│   ├── AwsToolkitClient.ts               ← MCP proxy lifecycle + callAws
│   ├── CloudWatchLogsToolV2.ts           ← Adapter: replaces CloudWatchLogsTool
│   ├── LogGroupDiscoveryToolV2.ts        ← Adapter: replaces LogGroupDiscoveryTool
│   └── EcsDeploymentToolV2.ts            ← Adapter: replaces EcsDeploymentTool
├── cloudwatch/
│   ├── CloudWatchLogsTool.ts             ← REMOVED after V2 validated
│   └── LogGroupDiscoveryTool.ts          ← REMOVED after V2 validated
└── ecs/
    └── EcsDeploymentTool.ts              ← REMOVED after V2 validated

tests/
├── unit/tools/
│   └── aws-toolkit/
│       ├── AwsToolkitClient.test.ts      ← NEW
│       ├── CloudWatchLogsToolV2.test.ts  ← NEW
│       ├── LogGroupDiscoveryToolV2.test.ts ← NEW
│       └── EcsDeploymentToolV2.test.ts   ← NEW
└── integration/tools/
    └── aws-toolkit/
        └── AwsToolkitClient.integration.test.ts ← NEW
```

**Structure Decision**: Single-project layout, extending existing `src/tools/` tree. New adapters live under `src/tools/aws-toolkit/`. No new top-level directories. Existing cloudwatch/ and ecs/ directories are cleaned up once V2 tools are fully validated.

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Docker sidecar for MCP proxy | AWS proxy has no npm distribution; Docker ECR image (`public.ecr.aws/mcp-proxy-for-aws/mcp-proxy-for-aws:latest`) is the clean deployment path for a container environment | `uvx` over stdio is valid for local dev only; no pre-compiled binary or npm package exists |
| Stateful MCP connection in otherwise stateless tool layer | MCP protocol requires persistent connection; proxy init takes 2–3 s | Per-call connections would add unacceptable latency per investigation iteration |
