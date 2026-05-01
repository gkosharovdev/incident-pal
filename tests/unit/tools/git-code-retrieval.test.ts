import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCodeRetrievalTool } from "../../../src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.js";
import {
  GitProviderError,
  type CommitInfo,
  type FileDiff,
  type FileContent,
  type GitProvider,
  type SymbolMatch,
  type VersionComparison,
} from "../../../src/tools/extensions/git-shared/GitProvider.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_FILE_DIFF: FileDiff = {
  filePath: "src/PaymentProcessor.ts",
  previousPath: null,
  changeType: "modified",
  unifiedDiff: "@@ -10,7 +10,6 @@\n-  if (amount === null) return;\n",
  linesAdded: 0,
  linesRemoved: 1,
};

const FAKE_COMMIT: CommitInfo = {
  sha: "abc1234567890abc1234567890abc1234567890ab",
  shortSha: "abc1234",
  message: "fix: remove null check in PaymentProcessor",
  authorName: "Alice",
  authorEmail: "alice@example.com",
  timestamp: "2026-04-30T12:00:00Z",
  parentShas: ["000000"],
  files: [FAKE_FILE_DIFF],
};

const FAKE_SYMBOL_MATCHES: SymbolMatch[] = [
  { filePath: "src/PaymentProcessor.ts", lineNumber: 10, matchContext: "class PaymentProcessor {" },
  { filePath: "src/index.ts", lineNumber: 3, matchContext: "import { PaymentProcessor } from" },
  { filePath: "tests/PaymentProcessor.test.ts", lineNumber: 1, matchContext: "describe('PaymentProcessor'" },
];

function makeCatalogYaml(withRepo = true): string {
  return `services:
  - id: payment-service${withRepo ? "\n    repositoryUrl: https://github.com/example-org/payment-service" : ""}
    displayName: Payment Service
`;
}

function makeCatalogPath(withRepo = true): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-"));
  const path = join(dir, "service-catalog.yml");
  writeFileSync(path, makeCatalogYaml(withRepo));
  return path;
}

function makeMockProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    getCommit: vi.fn().mockResolvedValue(FAKE_COMMIT),
    getFileContent: vi.fn(),
    compareCommits: vi.fn(),
    searchSymbol: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// get-commit operation
// ---------------------------------------------------------------------------

describe("GitCodeRetrievalTool — get-commit", () => {
  it("valid SHA returns commit info and diff", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
      ref: "abc1234567890abc1234567890abc1234567890ab",
    });

    expect(result.success).toBe(true);
    const data = result.data as CommitInfo;
    expect(data.sha).toBe(FAKE_COMMIT.sha);
    expect(data.files).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("valid tag ref resolves correctly — provider called with tag string", async () => {
    const getCommit = vi.fn().mockResolvedValue(FAKE_COMMIT);
    const provider = makeMockProvider({ getCommit });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
      ref: "v2.4.1",
    });

    expect(getCommit).toHaveBeenCalledWith(
      "example-org",
      "payment-service",
      "v2.4.1",
    );
  });

  it("diff cap sets truncated: true when diffs exceed maxDiffBytes", async () => {
    const largeDiff: FileDiff = {
      ...FAKE_FILE_DIFF,
      unifiedDiff: "x".repeat(200),
    };
    const commitWithLargeDiff: CommitInfo = {
      ...FAKE_COMMIT,
      files: [largeDiff, largeDiff, largeDiff],
    };
    const provider = makeMockProvider({
      getCommit: vi.fn().mockResolvedValue(commitWithLargeDiff),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath(), {
      maxDiffBytes: 250,
    });

    const result = await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
      ref: "abc1234",
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("requestTimeoutMs enforced — provider throws GitProviderError on timeout", async () => {
    const provider = makeMockProvider({
      getCommit: vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new GitProviderError("Request timed out after 1ms")),
              50,
            ),
          ),
      ),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath(), {
      requestTimeoutMs: 1,
    });

    const result = await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
      ref: "abc1234",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it("no catalog entry returns NO_REPO_CONFIGURED error", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath(false));

    const result = await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
      ref: "abc1234",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NO_REPO_CONFIGURED");
  });

  it("GitProviderError 404 returns structured error", async () => {
    const provider = makeMockProvider({
      getCommit: vi.fn().mockRejectedValue(new GitProviderError("Not Found", 404)),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
      ref: "nonexistent",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not Found");
  });

  it("missing ref field returns structured error", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-commit",
      serviceId: "payment-service",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('"ref"');
  });
});

// ---------------------------------------------------------------------------
// get-file operation
// ---------------------------------------------------------------------------

describe("GitCodeRetrievalTool — get-file", () => {
  const FAKE_FILE_CONTENT: FileContent = {
    filePath: "src/PaymentProcessor.ts",
    sha: "blobsha123",
    content: "export class PaymentProcessor {}",
    sizeBytes: 33,
  };

  it("valid path returns file content", async () => {
    const provider = makeMockProvider({
      getFileContent: vi.fn().mockResolvedValue(FAKE_FILE_CONTENT),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-file",
      serviceId: "payment-service",
      ref: "abc1234",
      filePath: "src/PaymentProcessor.ts",
    });

    expect(result.success).toBe(true);
    const data = result.data as FileContent;
    expect(data.content).toBe(FAKE_FILE_CONTENT.content);
    expect(result.truncated).toBe(false);
  });

  it("content cap sets truncated: true", async () => {
    const longContent = "a".repeat(600_000);
    const provider = makeMockProvider({
      getFileContent: vi.fn().mockResolvedValue({
        ...FAKE_FILE_CONTENT,
        content: longContent,
        sizeBytes: longContent.length,
      }),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-file",
      serviceId: "payment-service",
      ref: "abc1234",
      filePath: "src/PaymentProcessor.ts",
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("404 returns structured error", async () => {
    const provider = makeMockProvider({
      getFileContent: vi
        .fn()
        .mockRejectedValue(new GitProviderError("Not Found", 404)),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-file",
      serviceId: "payment-service",
      ref: "abc1234",
      filePath: "nonexistent.ts",
    });

    expect(result.success).toBe(false);
  });

  it("missing filePath returns structured error", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "get-file",
      serviceId: "payment-service",
      ref: "abc1234",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('"filePath"');
  });
});

// ---------------------------------------------------------------------------
// search-symbol operation
// ---------------------------------------------------------------------------

describe("GitCodeRetrievalTool — search-symbol", () => {
  it("matches returned correctly", async () => {
    const provider = makeMockProvider({
      searchSymbol: vi.fn().mockResolvedValue(FAKE_SYMBOL_MATCHES),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "search-symbol",
      serviceId: "payment-service",
      symbol: "PaymentProcessor",
    });

    expect(result.success).toBe(true);
    const data = result.data as { matches: SymbolMatch[]; totalCount: number };
    expect(data.matches).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it("zero matches returns success: true with empty array", async () => {
    const provider = makeMockProvider({
      searchSymbol: vi.fn().mockResolvedValue([]),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "search-symbol",
      serviceId: "payment-service",
      symbol: "NoSuchSymbol",
    });

    expect(result.success).toBe(true);
    const data = result.data as { matches: SymbolMatch[]; totalCount: number };
    expect(data.matches).toHaveLength(0);
  });

  it("results capped at maxSymbolResults sets truncated: true", async () => {
    const manyMatches: SymbolMatch[] = Array.from({ length: 10 }, (_, i) => ({
      filePath: `src/file${i}.ts`,
      lineNumber: i + 1,
      matchContext: `match ${i}`,
    }));
    const provider = makeMockProvider({
      searchSymbol: vi.fn().mockResolvedValue(manyMatches),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath(), {
      maxSymbolResults: 3,
    });

    const result = await tool.invoke({
      operation: "search-symbol",
      serviceId: "payment-service",
      symbol: "something",
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    const data = result.data as { matches: SymbolMatch[] };
    expect(data.matches).toHaveLength(3);
  });

  it("missing symbol returns structured error", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "search-symbol",
      serviceId: "payment-service",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('"symbol"');
  });
});

// ---------------------------------------------------------------------------
// compare operation
// ---------------------------------------------------------------------------

describe("GitCodeRetrievalTool — compare", () => {
  const FAKE_COMPARISON: VersionComparison = {
    baseSha: "base000",
    headSha: "head000",
    files: [FAKE_FILE_DIFF],
    totalFilesChanged: 1,
    totalLinesAdded: 0,
    totalLinesRemoved: 1,
    status: "ahead",
  };

  it("valid comparison returns aggregate diff", async () => {
    const provider = makeMockProvider({
      compareCommits: vi.fn().mockResolvedValue(FAKE_COMPARISON),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "compare",
      serviceId: "payment-service",
      baseRef: "v2.4.0",
      headRef: "v2.4.1",
    });

    expect(result.success).toBe(true);
    const data = result.data as VersionComparison;
    expect(data.totalFilesChanged).toBe(1);
    expect(data.files).toHaveLength(1);
  });

  it("diff cap applies across files", async () => {
    const largeDiff: FileDiff = {
      ...FAKE_FILE_DIFF,
      unifiedDiff: "y".repeat(200),
    };
    const comparison: VersionComparison = {
      ...FAKE_COMPARISON,
      files: [largeDiff, largeDiff, largeDiff],
    };
    const provider = makeMockProvider({
      compareCommits: vi.fn().mockResolvedValue(comparison),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath(), {
      maxDiffBytes: 250,
    });

    const result = await tool.invoke({
      operation: "compare",
      serviceId: "payment-service",
      baseRef: "v2.4.0",
      headRef: "v2.4.1",
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("reversed ref order returns success: false with INVALID_REF_ORDER error", async () => {
    const reversedComparison: VersionComparison = {
      ...FAKE_COMPARISON,
      status: "behind",
    };
    const provider = makeMockProvider({
      compareCommits: vi.fn().mockResolvedValue(reversedComparison),
    });
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "compare",
      serviceId: "payment-service",
      baseRef: "v2.4.1",
      headRef: "v2.4.0",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("INVALID_REF_ORDER");
  });

  it("missing baseRef returns structured error", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "compare",
      serviceId: "payment-service",
      headRef: "v2.4.1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('"baseRef"');
  });

  it("missing headRef returns structured error", async () => {
    const provider = makeMockProvider();
    const tool = new GitCodeRetrievalTool(provider, makeCatalogPath());

    const result = await tool.invoke({
      operation: "compare",
      serviceId: "payment-service",
      baseRef: "v2.4.0",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('"headRef"');
  });
});
