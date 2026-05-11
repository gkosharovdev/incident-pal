# Research: Log Group Filter Criteria

**Branch**: `005-log-group-filter-criteria` | **Date**: 2026-05-05

## Decision 1: AWS API for Log Group Discovery

**Decision**: Use `DescribeLogGroupsCommand` from `@aws-sdk/client-cloudwatch-logs` with `logGroupNamePrefix` for prefix filters and `logGroupNamePattern` for pattern filters.

**Rationale**: Both parameters are available in the existing AWS SDK v3 dependency that is already imported in `CloudWatchLogsTool.ts` (line 5). `logGroupNamePrefix` has been available since the service launched. `logGroupNamePattern` was added in 2022 and allows substring matching — exactly what is needed for cross-namespace discovery (e.g., "all groups containing `booking-service`"). No new SDK dependency is needed.

**Alternatives considered**:
- CloudWatch Logs filter patterns in queries — these filter log events within a group, not the group names themselves; not applicable here.
- ListTagsForResource per group — requires knowing the ARN in advance; defeats the purpose of dynamic discovery.
- AWS Resource Groups Tagging API — supports tag-based discovery but requires services to have consistent tagging conventions, which cannot be assumed.

---

## Decision 2: Tool Architecture — New `LogGroupDiscoveryTool` vs. Inline Discovery

**Decision**: Introduce a new narrow tool `LogGroupDiscoveryTool` (`log-group-discovery`) that accepts filter expressions as direct input and returns the list of matching log group names. The agent calls `service-catalog` first to obtain filters, then passes them to `log-group-discovery`.

**Rationale**: The constitution §VI requires that new data sources are integrated as narrow, read-only tools. The agent core (`InvestigationAgent.ts`) must not be modified to hardwire discovery logic. A dedicated tool keeps the discovery step visible in the trace (auditability §V), independently testable, and replaceable. Receiving filters as direct input (rather than looking them up internally from the catalog) keeps the tools decoupled.

**Alternatives considered**:
- Pre-compute discovery before the agent loop and inject the result as context — hides the discovery step from the trace, violating auditability requirement.
- Extend `CloudWatchLogsTool` to do discovery internally before querying — conflates two responsibilities (discovery and querying) and makes the tool harder to test independently.
- Modify `ServiceCatalogTool` to call DescribeLogGroups — couples catalog lookup with AWS network I/O; breaks single-responsibility principle.

---

## Decision 3: Multi-Group CloudWatch Queries — Per-Group vs. Batched

**Decision**: Keep `CloudWatchLogsTool` accepting a single `logGroup` per call. The agent issues one query call per discovered log group. Multi-group batching (CloudWatch Insights `logGroupNames[]`) is deferred.

**Rationale**: The `StartQueryCommand` does support `logGroupNames: string[]` (up to 50), but batching results means all groups' results are interleaved in a single response, making per-source evidence attribution harder to track. The current tool's single-group model produces clean per-source trace entries and is already tested. For the number of log groups typical in one service (2–10), separate calls are negligible overhead compared to the Insights query execution time.

**Alternatives considered**:
- Extend `CloudWatchLogsTool` input schema to accept `logGroupNames: string[]` — viable future optimisation but not required for the feature's functional goals; deferred to avoid scope creep.

---

## Decision 4: Backward Compatibility — Legacy `logGroups` Field

**Decision**: The `ServiceCatalogTool` synthesises a single `prefix` filter from the existing `logGroups[environment]` string when a catalog entry has no `logGroupFilters`. No catalog migration is required for existing entries.

**Rationale**: SC-004 requires zero regressions on existing catalog entries. The synthesised filter is equivalent to the current single-group behaviour because a DescribeLogGroups call with `logGroupNamePrefix = exact_group_name` will return exactly that group (if it exists) or zero groups (if it does not). The agent then calls CloudWatch on each result, producing identical behaviour to today.

**Alternatives considered**:
- Require catalog migration (replace `logGroups` with `logGroupFilters` for all entries) — breaks existing workflows and contradicts SC-004.
- Support both fields side-by-side at runtime, preferring `logGroupFilters` when present — this is what the spec says and what is implemented; no alternatives needed.

---

## Decision 5: Discovery Cap and Pagination

**Decision**: Cap discovery at 50 log groups per service (configurable via catalog entry `maxLogGroups` field). Use `DescribeLogGroups` pagination (nextToken) until the cap is reached. Record a `result-truncated` trace entry if the cap is hit before exhausting pages.

**Rationale**: SC-003 requires discovery in under 5 seconds for up to 50 groups. DescribeLogGroups returns up to 50 entries per page; a single API call covers the default cap with no pagination overhead. The existing `result-truncated` trace entry type is reused to record cap hits, maintaining consistency with how CloudWatch query truncation is reported today.

**Alternatives considered**:
- No cap — risks querying hundreds of groups for services with broadly matching patterns (e.g., `pattern:service` in an account with many services).
- Hard-coded cap with no override — too inflexible for services that legitimately span many log groups (e.g., a Lambda function with per-alias log groups).
