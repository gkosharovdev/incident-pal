import { describe, it, expect, vi } from "vitest";
import { InvestigationAgent } from "../../../src/agent/InvestigationAgent.js";
import type { Tool, ToolResult } from "../../../src/models/Tool.js";
import type { InvestigationRequest } from "../../../src/models/Investigation.js";

const BASE_REQUEST: InvestigationRequest = {
  serviceId: "order-service",
  environment: "production",
  linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
  timeWindow: { from: "2026-04-30T10:00:00Z", to: "2026-04-30T11:00:00Z" },
};

function makeThrowingTool(name: string): Tool {
  return {
    name,
    description: `Throwing tool ${name}`,
    inputSchema: { type: "object" },
    invoke: vi.fn().mockRejectedValue(new Error("tool crashed unexpectedly")),
  };
}

function makeFailingTool(name: string): Tool {
  return {
    name,
    description: `Failing tool ${name}`,
    inputSchema: { type: "object" },
    invoke: vi.fn().mockResolvedValue({ success: false, data: null, error: "service unavailable" } satisfies ToolResult),
  };
}

function makeMockAnthropicClient(toolName: string) {
  return {
    messages: {
      create: vi.fn()
        .mockResolvedValueOnce({
          content: [{ type: "tool_use", id: "tu-1", name: toolName, input: {} }],
          stop_reason: "tool_use",
        })
        .mockResolvedValueOnce({
          content: [],
          stop_reason: "end_turn",
        }),
    },
  };
}

describe("Tool error recovery", () => {
  it("records tool-error entry and continues when tool.invoke() throws", async () => {
    const throwingTool = makeThrowingTool("crash-tool");
    const anthropic = makeMockAnthropicClient("crash-tool");

    const agent = new InvestigationAgent({
      tools: [throwingTool],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const investigation = await agent.investigate(BASE_REQUEST);

    const errorEntries = investigation.trace
      .getEntries()
      .filter((e) => e.type === "tool-error");

    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]?.error).toContain("tool crashed");
    expect(investigation.status).not.toBe("failed");
  });

  it("records tool-error entry when tool returns success:false", async () => {
    const failingTool = makeFailingTool("fail-tool");
    const anthropic = makeMockAnthropicClient("fail-tool");

    const agent = new InvestigationAgent({
      tools: [failingTool],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const investigation = await agent.investigate(BASE_REQUEST);

    const errorEntries = investigation.trace
      .getEntries()
      .filter((e) => e.type === "tool-error");

    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]?.error).toBe("service unavailable");
  });

  it("investigation reaches complete status despite a tool error", async () => {
    const failingTool = makeFailingTool("partial-fail-tool");
    const anthropic = makeMockAnthropicClient("partial-fail-tool");

    const agent = new InvestigationAgent({
      tools: [failingTool],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const investigation = await agent.investigate(BASE_REQUEST);
    expect(["complete", "timed-out", "budget-exhausted"]).toContain(investigation.status);
  });
});
