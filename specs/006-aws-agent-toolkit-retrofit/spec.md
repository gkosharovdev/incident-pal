# Feature Specification: AWS Agent Toolkit Retrofit

**Feature Branch**: `006-aws-agent-toolkit-retrofit`
**Created**: 2026-05-12
**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CloudWatch Logs Investigation via AWS Toolkit (Priority: P1)

An on-call engineer triggers an incident investigation. The agent uses the AWS Agent Toolkit's generic AWS API call mechanism — rather than the custom CloudWatch Logs SDK wrapper — to run log queries, poll for results, and surface log entries. The investigation succeeds and produces the same quality of output as before.

**Why this priority**: CloudWatch log querying is the primary data source in every investigation. Replacing this tool first validates the core integration path and unblocks all other tool migrations.

**Independent Test**: Trigger a live investigation for a known service/environment/linking-key combination. Verify the investigation completes, the report is produced with log-based evidence, and no custom CloudWatch SDK calls are made.

**Acceptance Scenarios**:

1. **Given** a valid service name and linking key, **When** an investigation is started, **Then** the agent discovers relevant log groups and retrieves matching log entries via the AWS toolkit without any custom CloudWatch SDK code in the tool layer.
2. **Given** a log query that returns no results, **When** the agent polls for results, **Then** it correctly surfaces an empty result and continues the investigation.
3. **Given** a query that exceeds the scan budget threshold, **Then** the agent truncates results and flags the budget limit in the report, as before.

---

### User Story 2 - ECS Deployment Metadata via AWS Toolkit (Priority: P2)

The agent retrieves ECS service metadata (running task count, desired count, deployment events, task definition versions) during an investigation using the AWS Agent Toolkit instead of the custom ECS SDK wrapper.

**Why this priority**: ECS deployment context is the second most-used signal in investigations. Migration here completes coverage of the two primary AWS-native tools.

**Independent Test**: Run an investigation against a service that has had a recent deployment. Confirm the report includes deployment timeline and task counts without any custom ECS SDK dependency.

**Acceptance Scenarios**:

1. **Given** an ECS service with a recent deployment, **When** the agent requests deployment metadata, **Then** it retrieves deployment events and task counts via the AWS toolkit.
2. **Given** an ECS service name that does not exist in the specified environment, **Then** the agent receives a clear error and includes it in the trace without crashing.

---

### User Story 3 - Log Group Discovery via AWS Toolkit (Priority: P2)

Log group names are resolved from prefix/pattern expressions using the AWS Agent Toolkit's `DescribeLogGroups` equivalent, replacing the current custom LogGroupDiscoveryTool.

**Why this priority**: Log group discovery is invoked at the start of every CloudWatch-based investigation. Without it, Story 1 cannot function.

**Independent Test**: Given a service prefix expression, confirm all matching log groups are returned without custom CloudWatch SDK code.

**Acceptance Scenarios**:

1. **Given** a log group prefix, **When** the agent discovers log groups, **Then** all matching groups are returned in a single tool call via the AWS toolkit.
2. **Given** a prefix that matches no groups, **Then** an empty list is returned and the agent continues without error.

---

### Edge Cases

- What happens when the AWS Agent Toolkit's MCP server is temporarily unavailable during an ongoing investigation?
- How does the system behave when AWS credentials expire mid-investigation (toolkit requires restart on expiry)?
- What happens when a toolkit API call is throttled — does the investigation degrade gracefully or fail hard?
- How are scan-byte budgets tracked when AWS API responses are returned through the toolkit rather than the custom SDK (where byte counting was explicit)?
- What happens when the toolkit regional endpoint (us-east-1 or eu-central-1) is unreachable from the deployment environment?
- How does the investigation report surface tool errors that originate from the toolkit layer vs. the application layer?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The agent MUST be able to query CloudWatch Logs Insights (start query, poll results, retrieve entries) using the AWS Agent Toolkit without any direct AWS SDK CloudWatch client in the tool layer.
- **FR-002**: The agent MUST be able to discover CloudWatch log groups matching a prefix or pattern using the AWS Agent Toolkit.
- **FR-003**: The agent MUST be able to retrieve ECS service metadata (deployment events, task counts, task definition revisions) using the AWS Agent Toolkit.
- **FR-004**: All existing read-only safeguards MUST be preserved after migration — the agent MUST NOT be able to write to or modify any AWS resource during an investigation.
- **FR-005**: The investigation scan-budget enforcement MUST remain functional — byte usage from toolkit-returned responses MUST be tracked against the per-investigation limit.
- **FR-006**: The agent MUST surface clear, actionable error messages when the AWS toolkit is unavailable, throttles a request, or returns a service error.
- **FR-007**: The `ServiceCatalogTool`, `CustomerCorrelationTool`, `GitCodeRetrievalTool`, `RepoDocumentationTool`, `NotificationOutboxTool`, and `AuroraDbTool` are out of scope and MUST remain as custom implementations.
- **FR-008**: The `Tool` interface contract (`name`, `description`, `inputSchema`, `invoke`) MUST be preserved so the ToolRegistry and InvestigationAgent require no changes.
- **FR-009**: The migration MUST NOT introduce new mandatory runtime dependencies that break the existing integration test suite.
- **FR-010**: The agent MUST authenticate to the AWS toolkit MCP server using the same IAM credentials already configured for the deployment environment (no new credential stores introduced).
- **FR-011**: The agent MUST NOT execute scripts or code via `aws___run_script` or any equivalent mechanism. All AWS interactions during an investigation MUST go through concrete, typed `Tool` implementations. The agent calls tools; tools call APIs.

### Key Entities

- **ToolAdapter**: A thin wrapper that conforms to the existing `Tool` interface but delegates AWS API calls to the AWS Agent Toolkit rather than direct SDK clients; one adapter per replaced tool.
- **MCPClient**: The AWS Agent Toolkit MCP proxy connection; shared across all tool adapters in a single investigation session.
- **ToolResult**: Unchanged — the structured response (`success`, `data`, `error`, `scanBytesUsed`, `truncated`) returned to the InvestigationAgent after each tool call.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All investigations that succeed today continue to succeed after migration — zero regression in report quality or completeness across the existing golden-set evaluation scenarios.
- **SC-002**: The total number of custom AWS SDK client packages in the project is reduced by at least 60% (eliminating CloudWatch Logs and ECS clients at minimum).
- **SC-003**: Investigation end-to-end latency (from trigger to report) does not increase by more than 20% compared to the pre-migration baseline on the same golden-set scenarios.
- **SC-004**: The existing structural evaluation suite (Tier 1) passes with no new failures after migration.
- **SC-005**: The accuracy evaluation suite (Tier 2) maintains the same or better root-cause detection rate on the golden-set scenarios.
- **SC-006**: An investigation that encounters a toolkit-layer error (throttle, unavailability) surfaces a human-readable error in the report rather than an unhandled exception.

## Assumptions

- The AWS Agent Toolkit MCP server is reachable from the deployment environment; connectivity from the runtime to `us-east-1` or `eu-central-1` is available.
- The existing IAM role/user configured for incident-pal already has the permissions needed for CloudWatch Logs and ECS — no new IAM policy changes are required.
- The `aws login` credential method (or equivalent SSO/assume-role) is used rather than static access keys, satisfying the toolkit's requirement for auto-renewing credentials.
- The MCP proxy is run as a Docker sidecar using the public ECR image; no Python toolchain is required in the deployment environment.
- The AWS Agent Toolkit's `aws___call_aws` tool supports `cloudwatch-logs` and `ecs` service namespaces with the specific API operations currently used (`StartQuery`, `GetQueryResults`, `DescribeLogGroups`, `DescribeServices`).
- The `ServiceCatalogTool` linking-key schema and log group resolution logic remain the same — only the underlying AWS API call mechanism changes.
- The migration is a retrofit, not a rewrite: the investigation domain logic (ReAct loop, LinkingKeyExtractor, ScanBudget, ReportRenderer) is unchanged.
- The scope of this feature is three AWS-facing tools only: `CloudWatchLogsTool`, `LogGroupDiscoveryTool`, and `EcsDeploymentTool`. `AuroraDbTool` is out of scope.
