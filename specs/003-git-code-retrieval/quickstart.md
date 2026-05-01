# Quickstart: Git Code Retrieval & Repo Documentation Tools

**Branch**: `003-git-code-retrieval` | **Date**: 2026-05-01

---

## Prerequisites

1. A GitHub Personal Access Token with `repo` scope (for private repositories) or no scope (for public repositories) and `read:org` if code search spans an organisation.
2. Each service under investigation must have a `repositoryUrl` entry in `service-catalog.yml`.
3. `GITHUB_TOKEN` environment variable set in the agent's runtime environment.

---

## Registering the tools

```typescript
import { Octokit } from "@octokit/rest";
import { GitHubProvider } from "./src/tools/extensions/git-shared/GitHubProvider.js";
import { GitCodeRetrievalTool } from "./src/tools/extensions/git-code-retrieval/index.js";
import { RepoDocumentationTool } from "./src/tools/extensions/repo-documentation/index.js";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const provider = new GitHubProvider(octokit);

const agent = new InvestigationAgent({
  tools: [
    new CloudWatchLogsTool(cwClient),
    new EcsDeploymentTool(ecsClient),
    new ServiceCatalogTool(catalogPath),
    new AuroraDbTool(catalogPath),
    new GitCodeRetrievalTool(provider, catalogPath),     // ← new
    new RepoDocumentationTool(provider, catalogPath),    // ← new
  ],
});
```

Both tools share the same `GitHubProvider` instance — one Octokit client, two tools.

---

## Adding a service to the catalog

Open `service-catalog.yml` and add `repositoryUrl` to the service entry:

```yaml
services:
  - id: order-service
    repositoryUrl: https://github.com/your-org/order-service
    # ... existing fields unchanged
```

Both tools resolve the repository coordinates from this URL. If `repositoryUrl` is absent, the tool returns a structured error (`NO_REPO_CONFIGURED`) and the investigation continues without code context.

---

## How the agent uses the tools

The agent follows this sequence when a deployment is detected within the investigation time window:

1. Calls `repo-documentation` with the `serviceId` to read README, AGENTS.md, ADR files, and `.specify/` documentation.
2. Calls `git-code-retrieval` with `operation: "get-commit"` and the deployment SHA from `ecs-deployment` to retrieve the diff.
3. For suspicious changed files, calls `git-code-retrieval` with `operation: "search-symbol"` to locate the relevant method, then `operation: "get-file"` to read the full source.
4. Correlates the code path with DB entity state from `aurora-db`.
5. Produces a report with a "Code & Architecture Analysis" section synthesising all findings.

---

## Known limitations

### Symbol search is not ref-specific

`search-symbol` uses the GitHub Code Search API, which indexes the default branch (typically `main` or `master`). If the deployed commit is several commits behind HEAD, search results may reflect code that has changed since the deployment. The agent handles this by following up with `get-file` at the specific deployment ref, which does resolve to the exact commit.

**Workaround**: If `get-file` returns a 404 for a path found by symbol search, the file was likely added after the deployment ref. Try searching for the symbol at a nearby path or check the diff for renamed files.

### GitHub API rate limits

The GitHub REST API allows 5 000 requests per hour per token for authenticated requests. A typical investigation uses 5–15 API calls. If rate limiting occurs, the tool returns a structured error containing the `X-RateLimit-Reset` timestamp, and the agent notes the gap in the report.

### Binary files

`git-code-retrieval` omits diff content for binary files and marks the file path with `[binary file — diff omitted]`. The change type (added/modified/deleted) is still reported.

---

## Environment variables reference

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | — | Required. GitHub PAT for API authentication |
| `MAX_DIFF_BYTES` | `512000` | Per-invocation byte cap for diff output |
| `MAX_DOC_FILE_BYTES` | `204800` | Per-file byte cap for documentation and file content retrieval |
| `MAX_SYMBOL_RESULTS` | `50` | Maximum symbol search matches returned |
