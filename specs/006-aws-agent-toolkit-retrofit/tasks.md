# Tasks: AWS Agent Toolkit Retrofit

**Input**: Design documents from `specs/006-aws-agent-toolkit-retrofit/`
**Branch**: `006-aws-agent-toolkit-retrofit`

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story this task belongs to (US1/US2/US3)
- Exact file paths are included in every task description

---

## Phase 1: Setup

**Purpose**: Add the MCP client library and prepare the new tool directory.

- [X] T001 Add `@modelcontextprotocol/sdk` to `dependencies` in `package.json` and run `npm install`

---

## Phase 2: Foundational — AwsToolkitClient

**Purpose**: The shared MCP connection manager used by all three tool adapters. No user story work can begin until this is complete.

**⚠️ CRITICAL**: T005, T007, and T009 all depend on `AwsToolkitClient` being complete and tested.

- [X] T002 Implement `AwsToolkitClient` in `src/tools/aws-toolkit/AwsToolkitClient.ts` — class takes a `proxyUrl: string` constructor arg (read from `MCP_PROXY_URL` env var by callers), exposes `connect(): Promise<void>`, `callAws<T>(service: string, operation: string, params: Record<string, unknown>): Promise<AwsApiCallResult<T>>`, and `dispose(): Promise<void>`; uses `@modelcontextprotocol/sdk` HTTP/SSE transport to call the Docker sidecar proxy; surfaces all MCP errors as typed `AwsToolkitError` with the original MCP error message preserved
- [X] T003 Write unit tests for `AwsToolkitClient` in `tests/unit/tools/aws-toolkit-client.test.ts` — mock the `@modelcontextprotocol/sdk` `Client`; assert `callAws` serialises service/operation/params into the correct `aws___call_aws` MCP tool call; assert MCP errors are wrapped as `AwsToolkitError`; assert `dispose` closes the client
- [X] T004 Write integration test for `AwsToolkitClient` in `tests/integration/tools/aws-toolkit-client.test.ts` — use a local mock MCP server (in-process JSON-RPC stub) to verify the full connect → callAws → dispose lifecycle without a real proxy

**Checkpoint**: `AwsToolkitClient` is unit- and integration-tested. User story phases can now begin.

---

## Phase 3: User Story 1 — CloudWatch Logs Investigation (Priority: P1) 🎯 MVP

**Goal**: Replace `CloudWatchLogsTool` with a toolkit-backed adapter. An investigation can query CloudWatch Logs without any direct AWS SDK CloudWatch client.

**Independent Test**: Register only `CloudWatchLogsToolV2` (backed by a mock `AwsToolkitClient`) in a bare `InvestigationAgent` and assert that `invoke` returns a valid `ToolResult` with `entries`, `scanBytesUsed` populated, and `truncated` set correctly.

- [X] T005 [US1] Implement `CloudWatchLogsToolV2` in `src/tools/aws-toolkit/CloudWatchLogsToolV2.ts` — keeps `name = "cloudwatch-logs"`, same `inputSchema` and output shape as the legacy tool; calls `client.callAws("cloudwatch-logs", "DescribeLogGroups", ...)` for scan byte estimation, `client.callAws("cloudwatch-logs", "StartQuery", ...)` to start the query, and polls with `client.callAws("cloudwatch-logs", "GetQueryResults", ...)` until status is `Complete`; preserves `POLL_INTERVAL_MS`, `MAX_POLL_ATTEMPTS`, and `parseResultRows` logic from `src/tools/cloudwatch/CloudWatchLogsTool.ts`
- [X] T006 [US1] Write unit tests for `CloudWatchLogsToolV2` in `tests/unit/tools/cloudwatch-v2.test.ts` — mock `AwsToolkitClient`; assert all three `callAws` operations are called with correct arguments; assert `scanBytesUsed` is populated from `DescribeLogGroups`; assert polling loop handles `Running` → `Complete` status transitions; assert `truncated: true` when result count equals limit; assert toolkit errors surface as `{ success: false, error: "..." }`

**Checkpoint**: `CloudWatchLogsToolV2` is functional and tested. Story 1 MVP is deliverable.

---

## Phase 4: User Story 2 — ECS Deployment Metadata (Priority: P2)

**Goal**: Replace `EcsDeploymentTool` with a toolkit-backed adapter. An investigation can retrieve ECS deployment metadata without any direct AWS SDK ECS client.

**Independent Test**: Register only `EcsDeploymentToolV2` (backed by a mock `AwsToolkitClient`) and assert it returns a valid `ToolResult` with `deploymentsInWindow`, `currentRunningCount`, and `currentDesiredCount`.

**Note**: Phases 4 and 5 are fully independent — they touch different files and can be executed in parallel.

- [X] T007 [P] [US2] Implement `EcsDeploymentToolV2` in `src/tools/aws-toolkit/EcsDeploymentToolV2.ts` — keeps `name = "ecs-deployment"`, same `inputSchema` and output shape (`EcsResult`) as the legacy tool; calls `client.callAws("ecs", "DescribeServices", { cluster, services: [serviceName] })`; preserves the time-window filter on deployments from `src/tools/ecs/EcsDeploymentTool.ts`
- [X] T008 [P] [US2] Write unit tests for `EcsDeploymentToolV2` in `tests/unit/tools/ecs-v2.test.ts` — mock `AwsToolkitClient`; assert `callAws` is called with correct cluster and service args; assert deployments outside the time window are filtered out; assert service-not-found returns `{ success: false, error: "..." }`; assert toolkit errors surface cleanly

**Checkpoint**: `EcsDeploymentToolV2` is functional and tested independently of CloudWatch changes.

---

## Phase 5: User Story 3 — Log Group Discovery (Priority: P2)

**Goal**: Replace `LogGroupDiscoveryTool` with a toolkit-backed adapter. Log group resolution uses the toolkit with no direct CloudWatch SDK dependency.

**Independent Test**: Register only `LogGroupDiscoveryToolV2` (backed by a mock `AwsToolkitClient`) and assert it returns a `DiscoverySuccess` with `groups`, `capped`, and `totalFound` populated correctly for both `prefix` and `pattern` filter types.

**Note**: Phases 4 and 5 are fully independent — they touch different files and can be executed in parallel.

- [X] T009 [P] [US3] Implement `LogGroupDiscoveryToolV2` in `src/tools/aws-toolkit/LogGroupDiscoveryToolV2.ts` — keeps `name = "log-group-discovery"`, same `inputSchema`, `DiscoveredGroup` shape, and `HARD_MAX_GROUPS` cap as the legacy tool; calls `client.callAws("cloudwatch-logs", "DescribeLogGroups", ...)` with `logGroupNamePrefix` or `logGroupNamePattern` based on filter type; handles pagination via `nextToken`; preserves `GRACEFUL_AWS_CODES` soft-failure behaviour from `src/tools/cloudwatch/LogGroupDiscoveryTool.ts`
- [X] T010 [P] [US3] Write unit tests for `LogGroupDiscoveryToolV2` in `tests/unit/tools/log-group-discovery-v2.test.ts` — mock `AwsToolkitClient`; assert `prefix` filters use `logGroupNamePrefix`, `pattern` filters use `logGroupNamePattern`; assert pagination is followed until `nextToken` is absent; assert `capped: true` when group count hits `HARD_MAX_GROUPS`; assert graceful access-denied codes return `{ success: true }` with a warning rather than an error

**Checkpoint**: All three V2 adapters are implemented and independently tested. Migration cutover can begin.

---

## Phase 6: Migration Cutover

**Purpose**: Swap out all legacy tool registrations, verify quality gates pass, then delete legacy code and unused dependencies.

- [X] T011 Update `tests/integration/registry/tool-registration.test.ts` to register `CloudWatchLogsToolV2`, `LogGroupDiscoveryToolV2`, and `EcsDeploymentToolV2` (backed by a mock `AwsToolkitClient`) alongside the unchanged tools; assert all V2 tools appear in `getToolDefinitions()` with correct `name` strings
- [X] T012 Update `src/cli/index.ts` — remove `CloudWatchLogsClient`, `ECSClient`, `CloudWatchLogsTool`, `LogGroupDiscoveryTool`, `EcsDeploymentTool` imports; add `AwsToolkitClient`, `CloudWatchLogsToolV2`, `LogGroupDiscoveryToolV2`, `EcsDeploymentToolV2` imports; construct one `AwsToolkitClient` from `process.env["MCP_PROXY_URL"]`; pass it to all three V2 tool constructors; add `MCP_PROXY_URL` env var to the existing env validation block
- [X] T013 Update `src/tui/hooks/useInvestigation.ts` — same swap as T012: remove SDK client construction, add `AwsToolkitClient` construction using `process.env["MCP_PROXY_URL"]`, replace V1 tool instantiations with V2
- [X] T014 [P] Rename `src/tools/cloudwatch/CloudWatchLogsTool.ts` → `src/tools/cloudwatch/CloudWatchLogsToolLegacy.ts`
- [X] T015 [P] Rename `src/tools/cloudwatch/LogGroupDiscoveryTool.ts` → `src/tools/cloudwatch/LogGroupDiscoveryToolLegacy.ts`
- [X] T016 [P] Rename `src/tools/ecs/EcsDeploymentTool.ts` → `src/tools/ecs/EcsDeploymentToolLegacy.ts`
- [X] T017 Run full quality gate: `npm run typecheck && npm run lint && npm test && npm run test:integration && npm run eval:structural` — all must pass before proceeding
- [X] T018 [P] Delete `src/tools/cloudwatch/CloudWatchLogsToolLegacy.ts`, `src/tools/cloudwatch/LogGroupDiscoveryToolLegacy.ts`, and `src/tools/ecs/EcsDeploymentToolLegacy.ts`
- [X] T019 [P] Remove `@aws-sdk/client-cloudwatch-logs` and `@aws-sdk/client-ecs` from `dependencies` in `package.json`; run `npm install` to update `package-lock.json`

**Checkpoint**: All quality gates green with V2 tools active and legacy code deleted.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T020 Fix eval scenario bug in `evals/scenarios/S011-aurora-db.json`: change `"environment": "production"` to `"environment": "prod"` to match the current `z.enum(["prod", "dev"])` input schema
- [X] T021 Update `AGENTS.md` environment variables table — add `MCP_PROXY_URL` row (`http://mcp-proxy:8080/mcp` default for container deployment; `http://localhost:8080/mcp` for local dev) and add a note that the proxy is run as a Docker sidecar: `docker run public.ecr.aws/mcp-proxy-for-aws/mcp-proxy-for-aws:latest`
- [X] T022 [P] Update `README.md` (or create if absent) with a "Running the MCP proxy" section documenting the Docker sidecar command and the `MCP_PROXY_URL` env var

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1
- **Phase 3 (US1)**: Depends on Phase 2 — T005 and T006 require `AwsToolkitClient` complete
- **Phase 4 (US2)** and **Phase 5 (US3)**: Both depend on Phase 2; independent of each other and of Phase 3 — can run in parallel with Phase 3
- **Phase 6 (Cutover)**: Depends on Phases 3, 4, and 5 all complete
- **Phase 7 (Polish)**: Depends on Phase 6

### User Story Dependencies

- **US1 (P1)**: Requires Phase 2 only
- **US2 (P2)**: Requires Phase 2 only — independent of US1
- **US3 (P2)**: Requires Phase 2 only — independent of US1 and US2

### Within Each User Story

- Implementation task before unit test task within each story (tests need a real class to import)
- All V2 tool implementations before Phase 6 cutover begins

---

## Parallel Opportunities

### Phases 3, 4, and 5 in parallel (after Phase 2 completes)

```
After T004 completes:
  Track A: T005 → T006  (US1 CloudWatch)
  Track B: T007 → T008  (US2 ECS)
  Track C: T009 → T010  (US3 Log Group Discovery)
```

### Within Phase 6 (after T013 completes)

```
T014, T015, T016 — rename legacy files in parallel
then T017 — single quality gate run
then T018, T019 — delete legacy files and remove packages in parallel
```

### Phase 7

```
T020, T021, T022 — independent, all three can run in parallel
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1 (T001)
2. Complete Phase 2 (T002–T004)
3. Complete Phase 3 (T005–T006)
4. **Validate**: Register `CloudWatchLogsToolV2` in CLI, run a local investigation, confirm log entries appear in the report
5. Stop and demo before proceeding to Phase 4

### Full delivery

1. Phases 1–2: Foundation
2. Phases 3–5 in parallel (three tracks)
3. Phase 6: Cutover — quality gates must be green
4. Phase 7: Polish
