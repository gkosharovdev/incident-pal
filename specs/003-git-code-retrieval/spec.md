# Feature Specification: Git Code Retrieval Tool

**Feature Branch**: `003-git-code-retrieval`  
**Created**: 2026-05-01  
**Status**: Draft  
**Input**: User description: "the agent can already analyze logs from cloudwatch, inspect aurora sql db and build hypothesis based on that. However there is one more critical component missing to complete the analysis and that is correlating with the code that is deployed. While fetching the deployment of the ECS gives the version number there is not yet the tool that retrieves the code from the git repo. Specify such tool and add it to the agent"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Code Changes for a Deployed Version (Priority: P1)

During an investigation, the agent has identified a recent deployment via the ECS deployment tool. The agent needs to understand what changed in that deployment to determine whether the code change could be the root cause of the observed incident. The investigator (or the agent on their behalf) provides a version identifier (git commit SHA or tag), and the tool returns the list of changed files, the commit message, and the diff for each changed file.

**Why this priority**: This is the primary use case. Without being able to inspect what code shipped in the suspected deployment, the agent cannot close the loop between "a deployment happened around the time of the incident" and "here is the specific change that likely caused it". This delivers the highest diagnostic value.

**Independent Test**: Can be fully tested by providing a known commit SHA and verifying the tool returns the correct commit metadata, list of changed files, and diffs without making any write calls to the repository.

**Acceptance Scenarios**:

1. **Given** a valid commit SHA obtained from the ECS deployment tool, **When** the agent invokes the git code retrieval tool with that SHA, **Then** the tool returns the commit message, author, timestamp, list of changed files with their change types (added/modified/deleted), and the unified diff for each changed file.
2. **Given** a valid version tag (e.g., `v1.4.2`), **When** the agent invokes the tool with that tag, **Then** the tool resolves the tag to a commit and returns the same structured response as for a direct SHA.
3. **Given** a commit SHA that does not exist in the repository, **When** the agent invokes the tool, **Then** the tool returns a structured error result (success: false) with a clear message — the agent continues the investigation without crashing.

---

### User Story 2 - Retrieve File Content at a Specific Version (Priority: P2)

The agent has identified a suspicious file in the diff from Story 1. To reason about the specific logic change, the agent needs to read the full content of that file at the exact version that is running in production, rather than relying on the truncated diff context.

**Why this priority**: Diffs provide changed lines only. For complex logic bugs (off-by-one errors, configuration misreads, missing null checks), the agent needs the full file to reason accurately. This scenario augments Story 1 but is not required for a minimum viable investigation.

**Independent Test**: Can be fully tested by requesting a known file path at a known commit SHA and verifying the returned content matches the expected file at that revision.

**Acceptance Scenarios**:

1. **Given** a file path and a commit SHA, **When** the agent invokes the tool requesting file content, **Then** the tool returns the full raw content of that file as it existed at that commit.
2. **Given** a file path that did not exist at the requested commit (e.g., a newly created file that was later deleted), **When** the agent invokes the tool, **Then** the tool returns a structured error result with a clear message indicating the file was not found at that revision.

---

### User Story 3 - Compare Two Versions (Priority: P3)

The agent wants to compare the currently deployed version against the previously deployed version to understand the full scope of changes introduced by a rollout. This is especially useful when ECS shows two consecutive deployments and the agent needs the cumulative diff between them.

**Why this priority**: This is a convenience scenario. Stories 1 and 2 already enable the agent to retrieve changes per commit. Comparing two commits directly reduces the number of round-trips when multiple commits were included in a single deployment window.

**Independent Test**: Can be fully tested by providing two known commit SHAs and verifying the tool returns the combined diff of all commits between them.

**Acceptance Scenarios**:

1. **Given** two valid commit SHAs (base and head), **When** the agent invokes the tool requesting a comparison, **Then** the tool returns the aggregate list of changed files and the combined diff between the two commits.
2. **Given** two SHAs where base is newer than head (reversed order), **When** the agent invokes the tool, **Then** the tool returns a structured error indicating the revision order is invalid.

---

### User Story 4 - Read Architecture and Business Documentation (Priority: P1)

Before diving into diffs and code paths, the agent needs to understand the architecture and business flow of the affected service. It reads the repository's steering documentation — README, AGENTS.md, ADR files, and .specify memory files — to build a mental model of how the system is designed to work before attempting to identify what went wrong.

**Why this priority**: Without architectural context, the agent may misinterpret a code change or DB state as a root cause when it is actually intended behaviour. Reading documentation first prevents false hypotheses and makes subsequent code and DB analysis far more accurate.

**Independent Test**: Can be fully tested by invoking the `repo-documentation` tool against a repository with known documentation files and verifying it returns all expected files from the well-known paths without any write operations.

**Acceptance Scenarios**:

1. **Given** a repository with a README.md, AGENTS.md, and files under `.specify/` and `adr/`, **When** the agent invokes the `repo-documentation` tool, **Then** the tool returns a structured listing of all discovered documentation files with their full content.
2. **Given** a repository with no ADR folder and no `.specify/` directory, **When** the agent invokes the tool, **Then** the tool returns only the files that exist (e.g., README.md) without error — missing well-known paths are silently skipped.
3. **Given** a documentation file that exceeds the maximum payload size, **When** the tool reads it, **Then** the content is truncated and `truncated: true` is set on that file's entry.

---

### User Story 5 - Trace Method Invocations for a Hypothesis (Priority: P2)

The agent has formed a hypothesis based on log patterns — for example, "the payment processing step failed after the deployment." To validate this, the agent needs to find which files contain the relevant method or class names mentioned in the logs, then read those files to trace the call chain and understand the execution path that produced the error.

**Why this priority**: Without the ability to search for symbols by name, the agent would have to guess file paths or request entire directory listings — both are inefficient and unreliable at scale. Symbol search directly supports the "chain of method invocations" investigation step described in the feature goals.

**Independent Test**: Can be fully tested by searching for a known method name at a known commit SHA and verifying the tool returns the correct file paths and line numbers where the symbol appears.

**Acceptance Scenarios**:

1. **Given** a method or class name extracted from a log entry, **When** the agent invokes the symbol search operation, **Then** the tool returns the list of file paths and line numbers where the symbol is defined or referenced in the repository (results reflect the provider's indexed state, typically the default branch — see Assumptions).
2. **Given** a symbol name that does not exist in the codebase at the specified commit, **When** the agent invokes the symbol search, **Then** the tool returns an empty result set (not an error) so the agent can try alternate names.
3. **Given** a symbol name that matches more than the configurable maximum number of files, **When** the agent invokes the symbol search, **Then** the tool returns the top results up to the limit and sets `truncated: true`.

---

### Edge Cases

- What happens when the repository is unavailable or the API rate limit is reached?
- How does the tool handle very large diffs (hundreds of changed files or megabytes of diff output)?
- What happens when the version identifier from ECS does not match any git ref (e.g., the image was built without a git SHA label)?
- How does the tool behave when the repository requires authentication and credentials are not configured?
- What happens when a binary file is part of the diff?
- What happens when a symbol search term is too generic (e.g., "get") and returns thousands of matches?
- How does the tool handle symbol search in a repository with minified or generated code files?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST accept a git commit SHA (full or short form) as a version identifier and return structured metadata for that commit (message, author, timestamp, parent SHAs).
- **FR-002**: The tool MUST accept a git tag or branch name as a version identifier and resolve it to a commit before returning results.
- **FR-003**: The tool MUST return the list of files changed in a commit, with each file's change type (added, modified, deleted, renamed).
- **FR-004**: The tool MUST return the unified diff for each changed file in a commit, capped at a configurable maximum size (`MAX_DIFF_BYTES`); payloads that exceed the threshold MUST be truncated and `truncated: true` set in the result so the agent is informed.
- **FR-005**: The tool MUST support retrieving the full content of a specified file at a specified commit SHA.
- **FR-006**: The tool MUST support comparing two commit SHAs and returning the aggregate diff between them.
- **FR-007**: The tool MUST return a structured error result (success: false, error message) for all failure modes — missing ref, missing file, network error, auth failure — without throwing an unhandled exception.
- **FR-008**: Both tools comply with constitution §I (read-only); neither tool MUST push, create, modify, or delete any resource in the git repository.
- **FR-009**: *(Superseded by FR-004 — truncation behaviour and `truncated: true` flag are now specified there.)*
- **FR-010**: The tool MUST implement the `Tool` interface from `src/models/Tool.ts` and be registerable in `InvestigationAgent` without modifying any core agent files.
- **FR-011**: Both tools MUST accept the service catalog path at construction time; repository coordinates (`owner`, `repo`) are resolved from the catalog entry's `repositoryUrl` field per invocation. This is consistent with how `AuroraDbTool` resolves connection details from the catalog.
- **FR-013**: The tool MUST support searching for a symbol (method name, class name, or identifier) across all files in the repository at a specified commit SHA, returning file paths and line numbers for each match.
- **FR-014**: Symbol search results MUST be capped at a configurable maximum number of matches; results exceeding the cap MUST set `truncated: true`.
- **FR-015**: Symbol search with zero matches MUST return an empty result set with `success: true` (not an error), so the agent can try alternate search terms.
- **FR-017**: The `repo-documentation` tool MUST automatically scan the following well-known paths at the repository root: `README.md`, `AGENTS.md`, all files under `.specify/`, all files under `adr/`, and all files under `docs/adr/`.
- **FR-018**: The `repo-documentation` tool MUST silently skip well-known paths that do not exist in the repository — missing paths are not an error.
- **FR-019**: Each documentation file returned by the `repo-documentation` tool MUST include: file path, full text content, and a `truncated` flag if the content was capped at the maximum payload size.
- **FR-020**: The `repo-documentation` tool MUST implement the `Tool` interface independently of the git code retrieval tool (read-only constraint governed by FR-008 / constitution §I).
- **FR-016**: The agent's system prompt MUST be updated to instruct the agent to produce a "Code & Architecture Analysis" section in the investigation report when one or more code investigation tools (`git-code-retrieval`, `repo-documentation`) are registered. Steps referencing a tool that is not registered are silently skipped. The section MUST synthesise whatever evidence is available: architecture context from documentation, the code flow path related to the hypothesis, deployment diff, and correlation with current DB entity state. This change is governed by the constitution §III amendment (v1.2.0) permitting additive `SYSTEM_PROMPT` updates.
- **FR-012**: A separate `repo-documentation` tool MUST be delivered alongside the git code retrieval tool. It MUST discover and return the content of architecture and business documentation files within the repository (README, AGENTS.md, files under `.specify/`, and files under any `adr/` or `docs/adr/` directory). It MUST implement the `Tool` interface independently and be registerable without modifying core agent files.

### Key Entities

- **Commit**: A point-in-time snapshot of the repository. Key attributes: SHA (full 40-char), short SHA, message, author name, author email, timestamp (ISO 8601), parent SHAs.
- **FileDiff**: The changes to a single file within a commit. Key attributes: file path (before/after for renames), change type (added/modified/deleted/renamed), unified diff content, line counts (added/removed).
- **FileContent**: The raw content of a file at a specific commit. Key attributes: file path, commit SHA, content (string), size in bytes.
- **VersionComparison**: The aggregate diff between two commits. Key attributes: base SHA, head SHA, list of FileDiff entries, total files changed, total lines added, total lines removed.
- **SymbolMatch**: A location in the codebase where a named symbol appears. Key attributes: file path, line number, match context (the surrounding line of code), commit SHA.
- **DocumentationFile**: An architecture or business documentation file discovered by the `repo-documentation` tool. Key attributes: file path, text content, truncated flag, size in bytes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The agent can identify the specific file and line range most likely responsible for an incident within a single investigation session that includes a recent deployment, achieving this in investigations where a deployment occurred within the time window.
- **SC-002**: Diff retrieval for a typical deployment (up to 50 changed files) completes in under 5 seconds as observed by the agent — no investigation is blocked waiting on code retrieval.
- **SC-003**: The tool returns a usable structured result (success or structured error) for 100% of invocations — no unhandled exception ever surfaces to the agent.
- **SC-004**: Investigation reports produced when the code and documentation tools are available include a "Code & Architecture Analysis" section that synthesises deployment changes, relevant code flow, architecture context, and current DB entity state — making the report actionable without any additional manual lookup.
- **SC-005**: All existing investigation scenarios continue to pass at the same accuracy level after the tool is added, confirming the tool introduces no regressions.

## Clarifications

### Session 2026-05-01

- Q: Should documentation reading (README, AGENTS.md, .specify, ADRs) be part of the git code retrieval tool or a separate tool? → A: Separate `repo-documentation` tool. General principle: favour focused, single-responsibility tools over multi-mode tools.
- Q: What capability should the git code retrieval tool provide for tracing method invocations? → A: Both file content retrieval by path AND symbol/method name search across the repo — as separate, focused operations on the same tool.
- Q: How should the synthesised multi-source analysis (logs + code + docs + DB) be represented in the report? → A: Extend the agent's system prompt to guide it to produce a dedicated "Code & Architecture Analysis" section in the existing report when code investigation tools are available; no changes to the report renderer data model.
- Q: How should the `repo-documentation` tool discover which files to read? → A: The tool automatically scans well-known paths at the repo root (`README.md`, `AGENTS.md`, `.specify/`, `adr/`, `docs/adr/`) and returns a structured listing with file contents; no per-service catalog configuration required.

## Assumptions

- The version identifier surfaced by the ECS deployment tool (image tag or label) corresponds directly to a git commit SHA or tag in the service's source repository — this mapping is assumed to be consistent for all services in the catalog.
- Each service in the service catalog has at most one associated git repository. Multi-repo services are out of scope for this feature.
- The git repository is accessible via a remote API (e.g., GitHub API, GitLab API, or equivalent) from the environment where the agent runs; direct filesystem access to a local git clone is an acceptable alternative but not required.
- Repository authentication credentials (tokens, SSH keys) are managed outside the tool and injected at construction time — the tool does not handle credential rotation or OAuth flows.
- Diff payload size limits use the same configurable threshold pattern already established by `MAX_RESULTS_PER_QUERY`; a new `MAX_DIFF_BYTES` environment variable will follow the same convention.
- Binary file diffs are out of scope; the tool will return the file path and change type for binary files but will omit diff content, noting the file is binary.
- The service catalog will be extended to include the repository URL per service; this extension is a dependency of this feature.
- Symbol search results reflect the git provider's code index (typically the default branch HEAD), not an exact commit ref. The agent follows up symbol search with `get-file` at the specific deployment ref to read the authoritative file content. This is a known limitation documented in `quickstart.md`.
