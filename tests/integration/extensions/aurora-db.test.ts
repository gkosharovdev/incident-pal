import { describe, it, expect } from "vitest";
import { AuroraDbTool } from "../../../src/tools/extensions/aurora-db/AuroraDbTool.js";
import { ToolRegistry } from "../../../src/agent/ToolRegistry.js";
import type { PgClient } from "../../../src/tools/extensions/aurora-db/AuroraDbTool.js";
import type { AuroraDatabaseConfig } from "../../../src/tools/extensions/aurora-db/AuroraDbCatalogReader.js";

function makePassthroughClient(rows: Record<string, unknown>[] = []): PgClient {
  return {
    connect: () => Promise.resolve(),
    query: () => Promise.resolve({ rows }),
    end: () => Promise.resolve(),
  };
}

function makeAuroraTool(rows: Record<string, unknown>[] = []): AuroraDbTool {
  const config: AuroraDatabaseConfig = {
    host: "test.cluster.rds.amazonaws.com",
    port: 5432,
    database: "testdb",
    username: "iam_user",
    region: "eu-west-1",
    credentialSource: "iam",
  };
  return new AuroraDbTool("unused.yml", {
    catalogReader: { resolve: () => config },
    passwordResolver: () => Promise.resolve("token"),
    pgClientFactory: () => makePassthroughClient(rows),
  });
}

describe("AuroraDbTool integration", () => {
  it("registers in ToolRegistry and is discoverable by name", () => {
    const tool = makeAuroraTool();
    const registry = new ToolRegistry();
    registry.register(tool);

    expect(registry.lookup("aurora-db")).toBeDefined();
  });

  it("appears in getToolDefinitions() with correct name and schema", () => {
    const tool = makeAuroraTool();
    const registry = new ToolRegistry();
    registry.register(tool);

    const defs = registry.getToolDefinitions();
    const def = defs.find((d) => d.name === "aurora-db");

    expect(def).toBeDefined();
    expect(def?.description).toContain("Aurora");
    expect(def?.input_schema).toBeDefined();
  });

  it("is invokable through the registry and returns structured data", async () => {
    const rows = [{ id: "ord-9876", status: "pending" }];
    const tool = makeAuroraTool(rows);
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.lookup("aurora-db")!.invoke({
      serviceId: "order-service",
      environment: "production",
      query: "SELECT id, status FROM orders WHERE id = 'ord-9876'",
    });

    expect(result.success).toBe(true);
    const data = result.data as { rows: Array<{ id: string; status: string }> };
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.status).toBe("pending");
  });

  it("returns structured error (not throw) when catalog has no entry", async () => {
    const tool = new AuroraDbTool("unused.yml", {
      catalogReader: { resolve: () => null },
      passwordResolver: () => Promise.resolve("token"),
      pgClientFactory: () => makePassthroughClient(),
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.lookup("aurora-db")!.invoke({
      serviceId: "order-service",
      environment: "canary",
      query: "SELECT 1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NO_DB_CONFIGURED");
  });
});
