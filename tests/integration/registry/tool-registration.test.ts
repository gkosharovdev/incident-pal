import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/agent/ToolRegistry.js";
import type { Tool, ToolResult } from "../../../src/models/Tool.js";
import { CloudWatchLogsToolV2 } from "../../../src/tools/aws-toolkit/CloudWatchLogsToolV2.js";
import { EcsDeploymentToolV2 } from "../../../src/tools/aws-toolkit/EcsDeploymentToolV2.js";
import { LogGroupDiscoveryToolV2 } from "../../../src/tools/aws-toolkit/LogGroupDiscoveryToolV2.js";
import type { AwsToolkitClient } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";

function makeMockToolkitClient(): AwsToolkitClient {
  return { callAws: vi.fn(), connect: vi.fn(), dispose: vi.fn() } as unknown as AwsToolkitClient;
}

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

  it("V2 toolkit-backed tools register with correct names and input_schema", () => {
    const client = makeMockToolkitClient();
    const registry = new ToolRegistry();
    registry.register(new CloudWatchLogsToolV2(client));
    registry.register(new EcsDeploymentToolV2(client));
    registry.register(new LogGroupDiscoveryToolV2(client));

    const defs = registry.getToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(names).toContain("cloudwatch-logs");
    expect(names).toContain("ecs-deployment");
    expect(names).toContain("log-group-discovery");
    for (const def of defs) {
      expect(def).toHaveProperty("input_schema");
    }
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
