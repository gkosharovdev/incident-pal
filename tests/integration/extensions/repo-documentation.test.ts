import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoDocumentationTool } from "../../../src/tools/extensions/repo-documentation/RepoDocumentationTool.js";
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

describe("RepoDocumentationTool integration", () => {
  it("registers in ToolRegistry and is discoverable by name", () => {
    const tool = new RepoDocumentationTool(
      makeMockProvider(),
      makeCatalogPath(),
    );
    const registry = new ToolRegistry();
    registry.register(tool);

    expect(registry.lookup("repo-documentation")).toBeDefined();
  });

  it("appears in getToolDefinitions() with schema", () => {
    const tool = new RepoDocumentationTool(
      makeMockProvider(),
      makeCatalogPath(),
    );
    const registry = new ToolRegistry();
    registry.register(tool);

    const defs = registry.getToolDefinitions();
    const def = defs.find((d) => d.name === "repo-documentation");

    expect(def).toBeDefined();
    expect(def?.input_schema).toBeDefined();
  });
});
