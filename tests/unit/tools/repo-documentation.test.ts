import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoDocumentationTool } from "../../../src/tools/extensions/repo-documentation/RepoDocumentationTool.js";
import type { RepoDocumentationResult } from "../../../src/tools/extensions/repo-documentation/RepoDocumentationTool.js";
import {
  GitProviderError,
  type DirectoryEntry,
  type FileContent,
  type GitProvider,
} from "../../../src/tools/extensions/git-shared/GitProvider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCatalogPath(withRepo = true): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-"));
  const path = join(dir, "service-catalog.yml");
  writeFileSync(
    path,
    `services:\n  - id: payment-service${withRepo ? "\n    repositoryUrl: https://github.com/example-org/payment-service" : ""}\n    displayName: Payment Service\n`,
  );
  return path;
}

function makeFileContent(filePath: string, content: string): FileContent {
  return { filePath, sha: "sha123", content, sizeBytes: content.length };
}

function makeProvider(overrides?: Partial<GitProvider>): GitProvider {
  return {
    getCommit: vi.fn(),
    getFileContent:
      overrides?.getFileContent ??
      vi.fn().mockRejectedValue(new GitProviderError("Not Found", 404)),
    compareCommits: vi.fn(),
    searchSymbol: vi.fn(),
    listDirectory:
      overrides?.listDirectory ??
      vi.fn().mockRejectedValue(new GitProviderError("Not Found", 404)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RepoDocumentationTool", () => {
  it("returns all files when all well-known paths exist", async () => {
    const adrEntry: DirectoryEntry = {
      name: "001-architecture.md",
      path: "adr/001-architecture.md",
      type: "file",
    };

    const provider = makeProvider({
      getFileContent: vi
        .fn()
        .mockImplementation(
          (_owner: string, _repo: string, _ref: string, filePath: string) => {
            return Promise.resolve(
              makeFileContent(filePath, `# ${filePath} content`),
            );
          },
        ),
      listDirectory: vi.fn().mockResolvedValue([adrEntry]),
    });

    const tool = new RepoDocumentationTool(provider, makeCatalogPath());
    const result = await tool.invoke({ serviceId: "payment-service" });

    expect(result.success).toBe(true);
    const data = result.data as RepoDocumentationResult;
    expect(data.files.length).toBeGreaterThan(0);
    const paths = data.files.map((f) => f.filePath);
    expect(paths).toContain("README.md");
    expect(paths).toContain("AGENTS.md");
  });

  it("missing paths are silently skipped without error", async () => {
    const provider = makeProvider({
      getFileContent: vi
        .fn()
        .mockImplementation(
          (_owner: string, _repo: string, _ref: string, filePath: string) => {
            if (filePath === "README.md") {
              return Promise.resolve(
                makeFileContent(filePath, "# README content"),
              );
            }
            return Promise.reject(new GitProviderError("Not Found", 404));
          },
        ),
    });

    const tool = new RepoDocumentationTool(provider, makeCatalogPath());
    const result = await tool.invoke({ serviceId: "payment-service" });

    expect(result.success).toBe(true);
    const data = result.data as RepoDocumentationResult;
    expect(data.files.map((f) => f.filePath)).toContain("README.md");
    expect(data.missingPaths).toContain("AGENTS.md");
  });

  it("file exceeding byte cap sets truncated: true on that entry", async () => {
    const longContent = "a".repeat(300_000);
    const provider = makeProvider({
      getFileContent: vi.fn().mockImplementation(
        (_owner: string, _repo: string, _ref: string, filePath: string) => {
          if (filePath === "README.md") {
            return Promise.resolve(
              makeFileContent(filePath, longContent),
            );
          }
          return Promise.reject(new GitProviderError("Not Found", 404));
        },
      ),
    });

    const tool = new RepoDocumentationTool(provider, makeCatalogPath(), {
      maxFileSizeBytes: 100,
    });
    const result = await tool.invoke({ serviceId: "payment-service" });

    expect(result.success).toBe(true);
    const data = result.data as RepoDocumentationResult;
    const readme = data.files.find((f) => f.filePath === "README.md");
    expect(readme).toBeDefined();
    expect(readme?.truncated).toBe(true);
    expect(readme?.content.length).toBeLessThanOrEqual(100);
  });

  it("requestTimeoutMs enforced — provider timeout returns success: false", async () => {
    const provider = makeProvider({
      getFileContent: vi.fn().mockImplementation(
        () =>
          new Promise<FileContent>((_, reject) =>
            setTimeout(
              () => reject(new GitProviderError("Request timed out after 1ms")),
              50,
            ),
          ),
      ),
    });

    const tool = new RepoDocumentationTool(provider, makeCatalogPath(), {
      requestTimeoutMs: 1,
    });
    const result = await tool.invoke({ serviceId: "payment-service" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it("no catalog entry returns structured error", async () => {
    const provider = makeProvider();
    const tool = new RepoDocumentationTool(provider, makeCatalogPath(false));

    const result = await tool.invoke({ serviceId: "payment-service" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NO_REPO_CONFIGURED");
  });
});
