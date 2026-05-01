import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCodeRetrievalTool } from "../../../src/tools/extensions/git-code-retrieval/GitCodeRetrievalTool.js";
import { ToolRegistry } from "../../../src/agent/ToolRegistry.js";
import type { GitProvider } from "../../../src/tools/extensions/git-shared/GitProvider.js";

function makeCatalogPath(withRepo = true): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-"));
  const path = join(dir, "service-catalog.yml");
  writeFileSync(
    path,
    `services:\n  - id: order-service${withRepo ? "\n    repositoryUrl: https://github.com/example-org/order-service" : ""}\n    displayName: Order Service\n`,
  );
  return path;
}

function makeMockProvider(): GitProvider {
  return {
    getCommit: vi.fn(),
    getFileContent: vi.fn(),
    compareCommits: vi.fn(),
    searchSymbol: vi.fn(),
    listDirectory: vi.fn(),
  };
}

describe("GitCodeRetrievalTool integration", () => {
  it("registers in ToolRegistry and is discoverable by name", () => {
    const tool = new GitCodeRetrievalTool(
      makeMockProvider(),
      makeCatalogPath(),
    );
    const registry = new ToolRegistry();
    registry.register(tool);

    expect(registry.lookup("git-code-retrieval")).toBeDefined();
  });

  it("appears in getToolDefinitions() with schema", () => {
    const tool = new GitCodeRetrievalTool(
      makeMockProvider(),
      makeCatalogPath(),
    );
    const registry = new ToolRegistry();
    registry.register(tool);

    const defs = registry.getToolDefinitions();
    const def = defs.find((d) => d.name === "git-code-retrieval");

    expect(def).toBeDefined();
    expect(def?.input_schema).toBeDefined();
  });

  it("returns structured error (not throw) when catalog has no repositoryUrl", async () => {
    const tool = new GitCodeRetrievalTool(
      makeMockProvider(),
      makeCatalogPath(false),
    );
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.lookup("git-code-retrieval")!.invoke({
      operation: "get-commit",
      serviceId: "order-service",
      ref: "abc1234",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NO_REPO_CONFIGURED");
  });
});
