# Feature Specification: Log Group Filter Criteria for Investigation Scope

**Feature Branch**: `005-log-group-filter-criteria`
**Created**: 2026-05-05
**Status**: Draft

## Overview

Today the service catalog maps each service to a single, fixed log group path. When an incident spans multiple infrastructure layers — an RDS proxy, an ALB, an API Gateway stage, a Lambda function, and an ECS service — the fixed log group binding forces operators to know in advance exactly which log group contains the evidence. In practice evidence is spread across several groups, and the relevant group names are only known at investigation time.

This feature replaces the single log group field with a flexible **log group filter** model. Each service entry in the catalog can declare one or more filter expressions; the agent discovers and queries all matching log groups at runtime, giving investigations the breadth needed to surface cross-layer evidence.

## User Scenarios & Testing

### User Story 1 — Define multi-layer log scope in the catalog (Priority: P1)

An operator maintains the service catalog. They want to express "investigate all log groups that belong to booking-service" without listing each one individually and without needing to know whether it is an ECS task, an RDS proxy, or an ALB at catalog-authoring time.

**Why this priority**: This is the core data-model change. Everything else depends on it.

**Independent Test**: A catalog with filter-based entries can be loaded and the filters read back correctly; the existing single-group lookup continues to work unchanged.

**Acceptance Scenarios**:

1. **Given** a catalog entry with a prefix filter `prefix:/ecs/booking-service`, **When** the catalog is loaded, **Then** the service record exposes that filter expression for downstream use.
2. **Given** a catalog entry with multiple filter expressions (prefix + pattern), **When** the catalog is loaded, **Then** all filter expressions are present and ordered.
3. **Given** a catalog entry that still uses the legacy single log group field, **When** the catalog is loaded, **Then** the service is treated exactly as before (backward-compatible).

---

### User Story 2 — Agent discovers matching log groups at investigation start (Priority: P1)

When an investigation begins, the agent resolves the service's filter expressions against the actual log group inventory in the target AWS account and environment, producing a concrete list of log groups to query.

**Why this priority**: Filter expressions are only valuable if the agent can resolve them to real groups before querying.

**Independent Test**: Given a service with a filter expression and a mocked/real CloudWatch account, the agent can enumerate the matching log groups and report which ones it found (including zero matches).

**Acceptance Scenarios**:

1. **Given** a filter `prefix:/ecs/booking-service` and an account containing `/ecs/booking-service/app`, `/ecs/booking-service/proxy`, **When** the agent starts investigating, **Then** both groups are queried.
2. **Given** a filter that matches no log groups, **When** the agent starts investigating, **Then** the investigation continues and the trace records that no matching groups were found for that filter.
3. **Given** a filter `pattern:booking-service` matching groups across ECS, RDS Proxy, and ALB namespaces, **When** the agent starts, **Then** all matched groups are included in the query scope.
4. **Given** a service with both a filter expression and a legacy single-group field, **When** the agent starts, **Then** the filter expression takes precedence.

---

### User Story 3 — Investigation report lists which log groups were actually queried (Priority: P2)

After an investigation, the operator needs to know which log groups contributed evidence so they can trust the scope of the findings and know what was not covered.

**Why this priority**: Auditability of scope is necessary for incident post-mortems; operators need to know if a log group was missing or empty.

**Independent Test**: A completed investigation report names every log group queried, including ones that returned no results.

**Acceptance Scenarios**:

1. **Given** an investigation that queried three log groups, **When** the report is rendered, **Then** all three group names appear in the report's data sources section.
2. **Given** a filter that matched no log groups, **When** the report is rendered, **Then** the report notes that no log groups matched the filter for that service.

---

### Edge Cases

- Filter expression matches more than 50 log groups — the agent must cap discovery and note the truncation in the trace.
- AWS account has no CloudWatch Logs access — discovery fails gracefully; investigation proceeds with a warning and zero matched groups.
- Filter expression is syntactically invalid — catalog load surfaces a clear error rather than failing silently at investigation time.
- Two different filter expressions for the same service produce overlapping matches — duplicate log group names are de-duplicated before querying.
- Service catalog entry has neither a legacy log group field nor any filter expressions — treated as an error at catalog load time.

## Requirements

### Functional Requirements

- **FR-001**: The service catalog schema MUST support one or more log group filter expressions per service entry, in addition to or instead of a single log group path.
- **FR-002**: A filter expression MUST support at minimum two filter types: `prefix` (log groups whose name starts with a given string) and `pattern` (log groups whose name contains a given substring).
- **FR-003**: The catalog loader MUST accept legacy single-log-group entries without modification, treating them as equivalent to a single `prefix` filter matching that exact path.
- **FR-004**: At investigation start, the agent MUST resolve each filter expression against the live AWS account to obtain a concrete list of log group names before issuing any queries.
- **FR-005**: The agent MUST de-duplicate log group names when multiple filter expressions resolve to the same group.
- **FR-006**: The agent MUST record in the trace which log groups were discovered and which were actually queried.
- **FR-007**: When a filter expression matches no log groups, the agent MUST record a trace entry noting the empty result and continue the investigation rather than aborting.
- **FR-008**: Log group discovery MUST be capped at a configurable maximum (default 50 groups per service) to prevent runaway query scope; any cap hit MUST be noted in the trace.
- **FR-009**: The investigation report MUST list all log groups queried, grouped by the filter expression that resolved them.
- **FR-010**: An invalid filter expression (unrecognised type, empty string) MUST cause a clear error at catalog load time, not at investigation runtime.

### Key Entities

- **LogGroupFilter**: A named filter expression comprising a `type` (prefix | pattern) and a `value` string. A service entry holds an ordered list of these.
- **ResolvedLogGroups**: The runtime result of evaluating all filters for a service in a given environment — a de-duplicated, ordered list of concrete log group names, annotated with which filter produced each.
- **ServiceEntry** (updated): Previously held a single `logGroup` string per environment; now holds either a `logGroup` string (legacy) or a `logGroupFilters` list (new), with `logGroupFilters` taking precedence when both are present.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An operator can add a new infrastructure layer (e.g., RDS proxy) to an investigation's scope by editing one catalog entry, without changing any agent code.
- **SC-002**: An investigation that spans ECS + RDS Proxy + ALB log groups completes and includes evidence from all three layers in a single report run.
- **SC-003**: Log group discovery adds no more than 5 seconds to investigation startup time for a filter returning up to 50 groups.
- **SC-004**: Zero regressions on existing single-log-group catalog entries — all current investigations pass without catalog changes.
- **SC-005**: When a filter matches no log groups, the investigation still produces a report rather than failing; the report states clearly which filter returned no matches.

## Assumptions

- The AWS account hosting the services provides CloudWatch Logs `DescribeLogGroups` permission to the investigation role; discovery depends on this.
- The `prefix` filter type maps directly to the `logGroupNamePrefix` parameter of the CloudWatch Logs DescribeLogGroups API.
- The `pattern` filter type maps to the `logGroupNamePattern` parameter of the same API (available in CloudWatch Logs API since 2022).
- The maximum of 50 log groups per service is a safe default; operators can override it per service entry in the catalog.
- Lambda, ALB, API Gateway, and RDS Proxy all write logs to CloudWatch Logs under predictable naming conventions (e.g., `/aws/lambda/`, `/aws/rds/proxy/`) that prefix and pattern filters can express.
- Backward compatibility is required: all existing catalog entries must continue to work without modification.
