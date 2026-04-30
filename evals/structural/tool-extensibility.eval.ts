import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../src/agent/ToolRegistry.js";
import type { Tool, ToolResult } from "../../src/models/Tool.js";

describe("[Structural Eval] Tool extensibility", () => {
  it("a new tool registered in ToolRegistry is included in LLM tool definitions", () => {
    const registry = new ToolRegistry();

    const mockTool: Tool = {
      name: "custom-tool",
      description: "A custom extension tool",
      inputSchema: {
        type: "object",
        properties: { orderId: { type: "string" } },
        required: ["orderId"],
      },
      invoke: vi.fn().mockResolvedValue({ success: true, data: { found: true }, error: null } satisfies ToolResult),
    };

    registry.register(mockTool);

    const defs = registry.getToolDefinitions();
    const def = defs.find((d) => d.name === "custom-tool");
    expect(def).toBeDefined();
    expect(def?.description).toBe("A custom extension tool");
  });

  it("registered mock tool is invokable and returns known response", async () => {
    const registry = new ToolRegistry();

    const mockResult: ToolResult = {
      success: true,
      data: { status: "delivered", messageId: "msg-test-1" },
      error: null,
    };

    const mockTool: Tool = {
      name: "email-delivery-status",
      description: "Retrieve email delivery status for a notification",
      inputSchema: { type: "object", properties: {}, required: [] },
      invoke: vi.fn().mockResolvedValue(mockResult),
    };

    registry.register(mockTool);

    const tool = registry.lookup("email-delivery-status");
    expect(tool).toBeDefined();

    const result = await tool!.invoke({ messageId: "msg-test-1" });
    expect(result.success).toBe(true);
    expect((result.data as { status: string }).status).toBe("delivered");
  });
});
