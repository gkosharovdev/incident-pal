import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../../src/agent/ToolRegistry.js";
import type { Tool, ToolResult } from "../../../src/models/Tool.js";

function makeTool(name: string): Tool {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: "object", properties: {}, required: [] },
    invoke: async (): Promise<ToolResult> => ({ success: true, data: null, error: null }),
  };
}

describe("ToolRegistry", () => {
  it("registers and looks up a tool", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("my-tool");
    registry.register(tool);
    expect(registry.lookup("my-tool")).toBe(tool);
  });

  it("returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();
    expect(registry.lookup("missing")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("dup"));
    expect(() => registry.register(makeTool("dup"))).toThrow("already registered");
  });

  it("getAll returns all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    expect(registry.getAll()).toHaveLength(2);
  });

  it("getToolDefinitions returns correctly shaped objects", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("tool-x"));
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: "tool-x", description: "Test tool tool-x" });
    expect(defs[0]).toHaveProperty("input_schema");
  });
});
