# Research: Production Investigation Agent

**Feature**: 001-ecs-investigation-agent  
**Date**: 2026-04-30  
**Resolves**: All NEEDS CLARIFICATION items from plan Technical Context

---

## 1. Programming Language Choice

### Decision: TypeScript

**Rationale**: TypeScript is the recommended implementation language for this project.

**Team constraint**: The team is not familiar with Python. Python is the most commonly cited language in LLM/agent tutorials, but the maintenance cost of a Python codebase — including dependency hell, runtime version management, and the lack of team expertise — makes it an unacceptable choice for a production tool that on-call engineers will depend on. Python is excluded by the project constitution.

**TypeScript vs Java**:

| Dimension | TypeScript | Java |
|---|---|---|
| Agent building community adoption | Very high — the majority of open-source agent frameworks (Vercel AI SDK, LangChain.js, Mastra, LlamaIndex.TS) are TypeScript-first | Moderate — LangChain4j and Spring AI are solid but smaller communities |
| Anthropic SDK | First-class TypeScript SDK (`@anthropic-ai/sdk`) with streaming, tool use, and prompt caching support | Java SDK exists but is less actively maintained |
| AWS SDK | AWS SDK v3 is TypeScript-native with full CloudWatch Logs Insights and ECS support | AWS SDK for Java v2 is mature and well-supported |
| Tooling & ecosystem | npm/yarn, Vitest/Jest, ts-node, excellent IDE support | Maven/Gradle, JUnit 5, excellent IDE support |
| Deployment footprint | Node.js runtime, small Docker image | JVM startup time ~200–400ms; larger image |
| Agent eval frameworks | Braintrust, LangSmith, Vitest-based custom evals — all TypeScript-native | Limited eval tooling |
| Community momentum for agent building | **Leading** — most new agent patterns emerge in TypeScript first | Lagging by ~6–12 months |

**Conclusion**: TypeScript wins on agent building community adoption, SDK quality, and eval tooling. Java would be acceptable for a pure backend service but is not the right fit for an agent harness in 2025/2026. TypeScript is selected.

**Alternatives considered**: Python (excluded by constitution — team unfamiliarity), Go (no mature agent SDK), Rust (no mature agent SDK).

---

## 2. Agent Harness Design

### Decision: ReAct pattern with structured tool use via the Anthropic tool-use API

**Rationale**: The ReAct (Reasoning + Acting) pattern is the best-established approach for investigation agents that need to reason about evidence, select tools, observe results, and iterate. Anthropic's tool-use API implements this natively with the `tool_use` content block / `tool_result` message cycle.

**Key design choices**:

- **Orchestration**: Use the Anthropic SDK directly (not LangChain.js) for the agent loop to minimise abstraction and keep tool call traces deterministic and auditable. LangChain.js adds indirection that complicates trace recording.
- **Model**: Claude Sonnet (latest) for the investigation loop — balances reasoning quality with latency. Claude Haiku is used for cheaper sub-tasks (e.g., classifying log entries, extracting linking keys from JSON).
- **Tool definition pattern**: Each tool is a narrow TypeScript class implementing a `Tool` interface. Tools are registered in a `ToolRegistry` and injected into the agent at construction time (Dependency Inversion — constitution clause III).
- **Prompt caching**: Enable Anthropic prompt caching on the system prompt and tool definitions (these are large and static per investigation run). This reduces cost and latency for the multi-turn investigation loop.
- **Max iterations**: The agent loop enforces a configurable maximum iteration count (default: 20 tool calls) to prevent infinite loops. Exhausting the limit produces a partial report with a prominent warning.
- **Structured output**: The final report is requested as a structured JSON object (via tool use or `response_format`) to guarantee all required sections (timeline, evidence, hypotheses, confidence, actions) are present and parseable.

**Alternatives considered**:
- LangChain.js / LangGraph: More abstraction, harder to audit tool calls, slower to iterate. Rejected.
- Vercel AI SDK: Excellent for streaming UI use cases, but overkill for a CLI/programmatic tool. Rejected for core orchestration; acceptable for future UI wrapper.

---

## 3. Evals Design

### Decision: Two-tier eval strategy — structural evals (fast, always-run) + golden-set accuracy evals (slower, run on main and release branches)

**Rationale**: Agent evals are fundamentally different from unit tests — LLM outputs are non-deterministic. A purely assertion-based test suite would be brittle. The two-tier approach separates fast structural checks from accuracy benchmarks.

**Tier 1 — Structural evals (run on every PR)**:
- Assert the report contains all required sections (timeline, evidence, hypotheses, confidence, actions).
- Assert the trace contains an entry for every tool call that occurred.
- Assert no tool call performed a write operation (safety gate).
- Assert the investigation terminates within the max-iteration limit.
- Assert input validation rejects unknown services, missing linking keys, etc.
- These use deterministic mock tools (no real AWS calls) and run in <30 seconds.

**Tier 2 — Golden-set accuracy evals (run on main merge and release)**:
- A curated set of ≥10 incident scenarios with known root causes (ground truth established from real past incidents, anonymised).
- Each scenario provides: inputs (service, environment, linking key, time window) + mock tool responses (recorded fixtures from real investigations).
- Eval metric: root-cause identification accuracy ≥ 80% (SC-001). Computed as: `correct_root_cause_identified / total_scenarios`.
- Confidence calibration check: For scenarios where root cause is identified, reported confidence must be ≥ "medium". For scenarios where root cause is NOT identifiable from available evidence, the agent must explicitly state uncertainty (not hallucinate a conclusion).
- These evals use Vitest as the runner but call the actual LLM (not mocked) against recorded fixture data.

**Eval framework**: Custom Vitest-based harness. No third-party eval platform required for v1 (avoids vendor lock-in). The harness records: scenario ID, inputs, tool call trace, final report JSON, pass/fail verdict, and failure reason. Results are written to `evals/results/` as JSON for CI artefact upload.

**Alternatives considered**:
- Braintrust: Excellent product but requires external account/data egress. Rejected for v1.
- LangSmith: Same concern. Rejected for v1. Can be added as an optional exporter later.
- Prompt-based self-evaluation ("LLM judge"): Useful for qualitative checks but unreliable for binary pass/fail gates. Not used as the primary accuracy metric.

---

## 4. CloudWatch Logs Insights Integration

### Decision: Use AWS SDK v3 `@aws-sdk/client-cloudwatch-logs` with `StartQuery` / `GetQueryResults` polling

**Rationale**: CloudWatch Logs Insights is the standard read-only log query interface for AWS ECS services. The SDK provides full TypeScript types.

**Key patterns**:
- Query fields extracted: `@timestamp`, `@message` (parsed as JSON), plus named fields for correlation IDs (`traceId`, `correlationId`, `messageId`, `orderId`, etc. — configurable per log schema).
- Scan budget enforcement: Before submitting a query, estimate scanned data volume using the time window and log group size metadata (`DescribeLogGroups`). Abort if estimated scan would exceed the per-investigation budget.
- Polling: `StartQuery` returns a `queryId`; poll `GetQueryResults` with exponential backoff until `status === 'Complete'`.
- Result truncation: If results exceed the configurable result-count threshold (FR-012), truncate and record in trace.
- IAM requirement: The agent runtime needs `logs:StartQuery`, `logs:GetQueryResults`, `logs:DescribeLogGroups`, `logs:DescribeLogStreams` on the relevant log groups. No write permissions.

---

## 5. ECS Deployment Metadata Integration

### Decision: Use AWS SDK v3 `@aws-sdk/client-ecs` with `ListServices`, `DescribeServices`, `ListTaskDefinitions`, `DescribeTaskDefinition`

**Rationale**: ECS metadata is fully queryable read-only via the ECS API. Deployment timestamps are available from `DescribeServices` (`deployments[].updatedAt`).

**Key patterns**:
- Correlate deployment timestamps with the investigation time window to identify deployments that occurred during or just before the observation.
- IAM requirement: `ecs:ListServices`, `ecs:DescribeServices`, `ecs:ListTaskDefinitions`, `ecs:DescribeTaskDefinition`. No write permissions.

---

## 6. Cross-Service Correlation — Linking Key Extraction

### Decision: Extract linking keys from structured JSON log fields using a configurable field mapping per service

**Rationale**: The spec requires (FR-006, FR-013) that the agent follow entity identifiers, HTTP correlation IDs, and Kafka message IDs across service boundaries. Since logs are structured JSON (constitution assumption), linking keys can be extracted by field name.

**Pattern**:
- A `LinkingKeySchema` configuration (per service, stored in service catalog or config file) maps well-known field names to linking key types: e.g., `{ "traceId": "http-correlation-id", "orderId": "entity-id", "messageId": "kafka-message-id" }`.
- The agent maintains a `LinkingKeySet` (a set of all known identifiers for the current investigation). When a new log entry is retrieved, its fields are scanned for additional linking keys not already in the set. New keys are added and used in subsequent queries.
- This implements the "automatically extract and follow" requirement from FR-006 without requiring the engineer to enumerate all identifiers upfront.

---

## 7. Service Catalog Integration

### Decision: Start with a static YAML/JSON service registry; swap for a live API when one exists

**Rationale**: Many teams maintain service catalogs (Backstage, internal APIs). For v1, a static file is sufficient for service name validation (FR-010) and log field schema lookup. The interface is abstracted so it can be backed by a live API later.

---

## 8. Report Generation

### Decision: Generate Markdown report from a structured intermediate representation using a template renderer

**Rationale**: Requesting structured JSON from the LLM (via tool use) and then rendering it to Markdown in code (rather than asking the LLM to produce Markdown directly) produces more consistent, testable output. The intermediate representation can be asserted against in Tier 1 evals.

**Report sections** (from FR-003):
1. Investigation Summary (service, environment, linking keys, time window)
2. Timeline (chronological events with source and timestamp)
3. Evidence by Data Source (per tool, what was found)
4. Hypotheses (each with supporting evidence and confidence score)
5. Likely Failure Point (highest-confidence hypothesis)
6. Recommended Next Actions
7. Investigation Metadata (tool calls made, data sources queried, gaps noted, scan budget usage)
