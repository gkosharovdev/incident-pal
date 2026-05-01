# Data Model: Git Code Retrieval & Repo Documentation Tools

**Branch**: `003-git-code-retrieval` | **Date**: 2026-05-01

---

## Entities

### GitCodeRetrievalInput (tool input schema)

The value the LLM passes when calling `git-code-retrieval`. Discriminated by `operation`.

| Field | Type | Required | Description |
|---|---|---|---|
| `operation` | `"get-commit" \| "get-file" \| "compare" \| "search-symbol"` | Yes | Which retrieval operation to perform |
| `serviceId` | `string` | Yes | Service ID from the service catalog (resolves to `repositoryUrl`) |
| `ref` | `string` | Conditional | Commit SHA, tag, or branch name — required for `get-commit`, `get-file`, `search-symbol` |
| `filePath` | `string` | Conditional | Path within the repository — required for `get-file` |
| `baseRef` | `string` | Conditional | Base commit/tag — required for `compare` |
| `headRef` | `string` | Conditional | Head commit/tag — required for `compare` |
| `symbol` | `string` | Conditional | Method, class, or identifier to search for — required for `search-symbol` |

---

### CommitInfo (returned by `get-commit` operation)

| Field | Type | Description |
|---|---|---|
| `sha` | `string` | Full 40-character commit SHA |
| `shortSha` | `string` | 7-character abbreviated SHA |
| `message` | `string` | Full commit message |
| `authorName` | `string` | Author display name |
| `authorEmail` | `string` | Author email address |
| `timestamp` | `string` | ISO 8601 commit timestamp |
| `parentShas` | `string[]` | Full SHAs of parent commits (empty for root commit) |
| `files` | `FileDiff[]` | List of files changed in this commit |

---

### FileDiff (embedded in CommitInfo and VersionComparison)

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Current file path (post-rename path for renamed files) |
| `previousPath` | `string \| null` | Previous path for renamed files; `null` otherwise |
| `changeType` | `"added" \| "modified" \| "deleted" \| "renamed"` | Nature of the change |
| `unifiedDiff` | `string` | Unified diff content (may be empty for binary files) |
| `linesAdded` | `number` | Lines added in this file |
| `linesRemoved` | `number` | Lines removed in this file |

Binary files: `unifiedDiff` is `""` and a note `"[binary file — diff omitted]"` is appended to `filePath` to inform the agent.

---

### FileContent (returned by `get-file` operation)

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Path of the file as requested |
| `sha` | `string` | Blob SHA of the file at the requested ref |
| `content` | `string` | Full decoded text content (UTF-8); truncated if `> MAX_DOC_FILE_BYTES` |
| `sizeBytes` | `number` | Original size in bytes (before any truncation) |

---

### VersionComparison (returned by `compare` operation)

| Field | Type | Description |
|---|---|---|
| `baseSha` | `string` | Resolved full SHA of the base ref |
| `headSha` | `string` | Resolved full SHA of the head ref |
| `files` | `FileDiff[]` | All files changed between base and head |
| `totalFilesChanged` | `number` | Count of entries in `files` |
| `totalLinesAdded` | `number` | Sum of `linesAdded` across all files |
| `totalLinesRemoved` | `number` | Sum of `linesRemoved` across all files |

---

### SymbolMatch (element of array returned by `search-symbol` operation)

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Repository-relative path where the symbol appears |
| `lineNumber` | `number` | 1-based line number of the match |
| `matchContext` | `string` | The full source line containing the match |

---

### GitCodeRetrievalResult (stored in `ToolResult.data` for `git-code-retrieval`)

A discriminated union keyed by `operation`:

| `operation` | `data` type | `truncated` meaning |
|---|---|---|
| `get-commit` | `CommitInfo` | One or more file diffs were trimmed to stay within `MAX_DIFF_BYTES` |
| `get-file` | `FileContent` | File content was trimmed to stay within `MAX_DOC_FILE_BYTES` |
| `compare` | `VersionComparison` | One or more file diffs were trimmed to stay within `MAX_DIFF_BYTES` |
| `search-symbol` | `{ matches: SymbolMatch[]; totalCount: number }` | GitHub index has more results than `MAX_SYMBOL_RESULTS` |

---

### RepoDocumentationInput (tool input schema)

| Field | Type | Required | Description |
|---|---|---|---|
| `serviceId` | `string` | Yes | Service ID from the service catalog |

---

### DocumentationFile (element of array in `RepoDocumentationResult`)

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Repository-relative path |
| `content` | `string` | Decoded text content; truncated to `MAX_DOC_FILE_BYTES` if large |
| `sizeBytes` | `number` | Original file size in bytes |
| `truncated` | `boolean` | `true` if content was capped |

---

### RepoDocumentationResult (stored in `ToolResult.data` for `repo-documentation`)

| Field | Type | Description |
|---|---|---|
| `files` | `DocumentationFile[]` | All discovered documentation files in well-known paths |
| `scannedPaths` | `string[]` | Well-known paths that were attempted (found or not) |
| `missingPaths` | `string[]` | Well-known paths that returned 404 (silently skipped) |

---

### ServiceEntry extension (service-catalog.yml)

The existing `ServiceEntry` interface in `ServiceCatalogTool.ts` is **not modified**. `GitCatalogReader` reads the same YAML and accesses the new `repositoryUrl` field independently.

```typescript
// New, standalone interface — not added to src/models/
interface GitServiceEntry {
  id: string;
  repositoryUrl?: string;  // e.g. "https://github.com/example-org/order-service"
}
```

New `service-catalog.yml` field (added to all five services):

```yaml
repositoryUrl: https://github.com/example-org/{service-id}
```

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `MAX_DIFF_BYTES` | `512000` (500 KB) | Per-invocation cap for diff output in `GitCodeRetrievalTool` |
| `MAX_DOC_FILE_BYTES` | `204800` (200 KB) | Per-file cap in `RepoDocumentationTool` and `get-file` operation |
| `MAX_SYMBOL_RESULTS` | `50` | Maximum `SymbolMatch` entries returned by `search-symbol` |
| `GITHUB_TOKEN` | — | GitHub Personal Access Token (read-only scopes: `repo` contents + code search) |
