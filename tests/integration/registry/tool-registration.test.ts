import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/agent/ToolRegistry.js";
import type { Tool, ToolResult } from "../../../src/models/Tool.js";

function makeTool(name: string): Tool {
  return {
    name,
    description: `Integration test tool: ${name}`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    invoke: vi.fn().mockResolvedValue({ success: true, data: { result: "ok" }, error: null } satisfies ToolResult),
  };
}

describe("ToolRegistry integration", () => {
  it("third-party mock tool registered at construction time is in LLM tool definitions", () => {
    const thirdPartyTool = makeTool("payment-status");
    const registry = new ToolRegistry();
    registry.register(thirdPartyTool);

    const defs = registry.getToolDefinitions();
    const def = defs.find((d) => d.name === "payment-status");
    expect(def).toBeDefined();
    expect(def?.description).toContain("payment-status");
    expect(def).toHaveProperty("input_schema");
  });

  it("multiple tools from different domains coexist without conflict", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("cloudwatch-logs"));
    registry.register(makeTool("ecs-deployment"));
    registry.register(makeTool("notification-outbox"));
    registry.register(makeTool("payment-gateway"));

    expect(registry.getAll()).toHaveLength(4);
    expect(registry.getToolDefinitions()).toHaveLength(4);
  });

  it("tools from different domains are independently invokable", async () => {
    const registry = new ToolRegistry();
    const cwTool = makeTool("cloudwatch-logs");
    const ecsT = makeTool("ecs-deployment");
    registry.register(cwTool);
    registry.register(ecsT);

    const cwResult = await registry.lookup("cloudwatch-logs")!.invoke({ query: "test" });
    const ecsResult = await registry.lookup("ecs-deployment")!.invoke({ query: "test" });

    expect(cwResult.success).toBe(true);
    expect(ecsResult.success).toBe(true);
  });
});
