import { describe, it, expect } from "vitest";
import type { Tool, ToolResult } from "../../src/models/Tool.js";

const WRITE_VERBS = ["put", "post", "delete", "create", "update", "write", "insert", "remove"];

function descriptionContainsWriteVerb(description: string): boolean {
  const lower = description.toLowerCase();
  return WRITE_VERBS.some((verb) => lower.includes(verb));
}

describe("[Structural Eval] Safety: read-only tool validation", () => {
  it("tool descriptions must not imply write capability", () => {
    const safeTools: Tool[] = [
      {
        name: "cloudwatch-logs",
        description: "Query CloudWatch Logs Insights for structured log entries",
        inputSchema: { type: "object" },
        invoke: async (): Promise<ToolResult> => ({ success: true, data: null, error: null }),
      },
      {
        name: "ecs-deployment",
        description: "Retrieve ECS deployment metadata for a service",
        inputSchema: { type: "object" },
        invoke: async (): Promise<ToolResult> => ({ success: true, data: null, error: null }),
      },
    ];

    for (const tool of safeTools) {
      expect(descriptionContainsWriteVerb(tool.description)).toBe(false);
    }
  });

  it("flags a tool description that implies write capability", () => {
    const unsafeTool: Tool = {
      name: "danger-tool",
      description: "Delete log entries from CloudWatch",
      inputSchema: { type: "object" },
      invoke: async (): Promise<ToolResult> => ({ success: true, data: null, error: null }),
    };

    expect(descriptionContainsWriteVerb(unsafeTool.description)).toBe(true);
  });
});
