# Research: Git Code Retrieval & Repo Documentation Tools

**Branch**: `003-git-code-retrieval` | **Date**: 2026-05-01

---

## Decision 1: Git provider client library

**Decision**: Use `@octokit/rest` v21 as the HTTP client for GitHub API access, injected behind a `GitProvider` interface.

**Rationale**: The project already uses typed HTTP clients injected at construction time (see `NotificationOutboxTool`). `@octokit/rest` ships its own TypeScript types (no separate `@types/` package needed), has first-party rate-limit handling, and aligns with the existing pattern of using purpose-built SDK clients rather than raw `fetch`. The `GitProvider` interface keeps `GitHubProvider` from leaking into tool logic, preserving substitutability for a future `GitLabProvider`.

**Alternatives considered**:
- `simple-git` / `isomorphic-git` for local clone operations: requires a cloned copy of the repo to be available on disk, which is not guaranteed in the agent's deployment environment.
- Raw `fetch` with the GitHub REST API: functional but lacks pagination helpers, retry logic, and typed responses that `@octokit/rest` provides.
- `@octokit/graphql` for ref-specific code search: GitHub's GraphQL API does support searching by ref, but adds complexity; the REST API is sufficient for the investigation use case.

---

## Decision 2: Symbol search scope and limitations

**Decision**: Symbol search uses the GitHub Code Search API (`GET /search/code`) with a `repo:owner/repo` qualifier. Search results reflect GitHub's code index, which tracks the default branch rather than a specific commit ref.

**Rationale**: GitHub's REST API does not support content search scoped to an arbitrary commit SHA. The GraphQL `search` query is similarly index-based. For incident investigation, the deployed commit is typically within a few commits of the default branch HEAD; the agent uses symbol search to locate candidate files, then calls `get-file` with the exact deployment ref to read the authoritative content. This two-step approach is consistent with how a human engineer would investigate.

**Known limitation**: Documented in `quickstart.md`. If the search result points to a file that was moved or deleted between HEAD and the deployment ref, `get-file` will return a 404 (structured error) and the agent should try alternate paths.

**Alternatives considered**:
- Getting the full file tree at the ref and doing client-side text matching: requires fetching potentially thousands of files; impractical within the agent's scan budget and iteration limit.
- Caching a local clone for fast grep: out of scope for this feature; adds infrastructure dependency.

---

## Decision 3: Payload size management

**Decision**: Two separate environment variable caps: `MAX_DIFF_BYTES` (default 500 KB) for `GitCodeRetrievalTool` and `MAX_DOC_FILE_BYTES` (default 200 KB per file) for `RepoDocumentationTool`. Both follow the `MAX_RESULTS_PER_QUERY` convention already in the project.

**Rationale**: Diffs can be large (especially for bulk refactors); a per-invocation byte cap prevents oversized tool results from exhausting the agent's context window. Documentation files are typically small but some (e.g., a large architecture doc) can be verbose; a per-file cap is more appropriate than a total cap to ensure all discovered files are at least partially returned.

**Alternatives considered**:
- Single global cap shared by both tools: documentation files and diffs have very different size profiles; a single cap would either be too tight for diffs or too loose for doc files.
- No cap, rely on API pagination: the agent has a finite context window and iteration budget; uncapped payloads risk budget exhaustion before the investigation completes.

---

## Decision 4: Repository URL parsing strategy

**Decision**: `GitCatalogReader` parses `repositoryUrl` from the service catalog using a simple regex that extracts `{owner}/{repo}` from any `https://github.com/{owner}/{repo}` URL. The parsed tuple is passed to `GitHubProvider` method calls.

**Rationale**: All services in the catalog are expected to use GitHub (the only git provider in scope for this feature). Parsing at read time avoids storing provider-specific structured fields in the catalog. If GitLab support is added later, the catalog format can be extended with a `repositoryProvider` field and the reader updated without changing tool code.

**Alternatives considered**:
- Storing `{ owner, repo, provider }` as separate fields in the catalog: more explicit but adds catalog maintenance overhead for all five services.
- Having the tool accept `owner` and `repo` directly as input fields: makes the LLM responsible for knowing repository coordinates, which it should not need to know.

---

## Decision 5: Documentation directory traversal depth

**Decision**: `RepoDocumentationTool` traverses well-known directories (`.specify/`, `adr/`, `docs/adr/`) one level deep only — no recursive descent. Individual files within those directories are fetched; sub-directories are listed but not recursed into.

**Rationale**: ADR collections and `.specify/` directories rarely exceed one nesting level for the documentation files the agent needs. Deep recursion would multiply API calls and risk rate limiting. For the investigation use case, the top-level files in these directories provide sufficient architectural context.

**Alternatives considered**:
- Full recursive traversal: too many API calls; unpredictable depth in arbitrary repositories.
- Configurable depth at construction time: adds complexity without a clear need; can be added in a follow-up if an operator requires it.
