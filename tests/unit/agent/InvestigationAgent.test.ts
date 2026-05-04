import { describe, it, expect, vi } from "vitest";
import { InvestigationAgent } from "../../../src/agent/InvestigationAgent.js";
import type { Tool, ToolResult } from "../../../src/models/Tool.js";
import type { InvestigationRequest } from "../../../src/models/Investigation.js";

const BASE_REQUEST: InvestigationRequest = {
  serviceId: "order-service",
  environment: "prod",
  linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
  timeWindow: {
    from: "2026-04-30T10:00:00Z",
    to: "2026-04-30T11:00:00Z",
  },
};

function makeMockTool(name: string, result: ToolResult): Tool {
  return {
    name,
    description: `Mock ${name}`,
    inputSchema: { type: "object" },
    invoke: vi.fn().mockResolvedValue(result),
  };
}

function makeMockAnthropicClient(responses: Partial<{ content: unknown[]; stop_reason: string }>[]) {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(() => {
        const response = responses[callIndex] ?? responses[responses.length - 1];
        callIndex++;
        return Promise.resolve({
          content: response?.content ?? [],
          stop_reason: response?.stop_reason ?? "end_turn",
        });
      }),
    },
  };
}

describe("InvestigationAgent", () => {
  it("applies default 60-minute time window when none provided", async () => {
    const anthropic = makeMockAnthropicClient([{ content: [], stop_reason: "end_turn" }]);
    const agent = new InvestigationAgent({
      tools: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const requestWithoutWindow: InvestigationRequest = {
      ...BASE_REQUEST,
      timeWindow: undefined,
    };
    const investigation = await agent.investigate(requestWithoutWindow);

    expect(investigation.request.timeWindow).toBeDefined();
    const from = new Date(investigation.request.timeWindow!.from);
    const to = new Date(investigation.request.timeWindow!.to);
    const diffMs = to.getTime() - from.getTime();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it("starts with investigation-started trace entry", async () => {
    const anthropic = makeMockAnthropicClient([{ content: [], stop_reason: "end_turn" }]);
    const agent = new InvestigationAgent({
      tools: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const investigation = await agent.investigate(BASE_REQUEST);
    const entries = investigation.trace.getEntries();

    expect(entries[0]?.type).toBe("investigation-started");
  });

  it("records tool-call TraceEntry for each tool invoked", async () => {
    const toolA = makeMockTool("tool-a", { success: true, data: { result: "ok" }, error: null });

    const anthropic = makeMockAnthropicClient([
      {
        content: [
          { type: "tool_use", id: "tu-1", name: "tool-a", input: { query: "test" } },
        ],
        stop_reason: "tool_use",
      },
      { content: [], stop_reason: "end_turn" },
    ]);

    const agent = new InvestigationAgent({
      tools: [toolA],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const investigation = await agent.investigate(BASE_REQUEST);
    const toolCallEntries = investigation.trace
      .getEntries()
      .filter((e) => e.type === "tool-call");

    expect(toolCallEntries).toHaveLength(1);
    expect(toolCallEntries[0]?.toolName).toBe("tool-a");
  });

  it("records tool-error TraceEntry when tool returns success:false", async () => {
    const failingTool = makeMockTool("bad-tool", {
      success: false,
      data: null,
      error: "service down",
    });

    const anthropic = makeMockAnthropicClient([
      {
        content: [
          { type: "tool_use", id: "tu-1", name: "bad-tool", input: {} },
        ],
        stop_reason: "tool_use",
      },
      { content: [], stop_reason: "end_turn" },
    ]);

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
    expect(errorEntries[0]?.error).toBe("service down");
  });

  it("sets status to timed-out when timer expires before iterations complete", async () => {
    const anthropic = makeMockAnthropicClient([
      {
        content: [
          { type: "tool_use", id: "tu-1", name: "slow-tool", input: {} },
        ],
        stop_reason: "tool_use",
      },
      { content: [], stop_reason: "end_turn" },
    ]);

    const agent = new InvestigationAgent({
      tools: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
      maxDurationMs: 0,
    });

    const investigation = await agent.investigate(BASE_REQUEST);
    expect(investigation.status).toBe("timed-out");

    const timedOutEntries = investigation.trace
      .getEntries()
      .filter((e) => e.type === "timed-out");
    expect(timedOutEntries.length).toBeGreaterThan(0);
  });

  it("observationDescription is passed through to request on the investigation", async () => {
    const anthropic = makeMockAnthropicClient([{ content: [], stop_reason: "end_turn" }]);
    const agent = new InvestigationAgent({
      tools: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropicClient: anthropic as any,
    });

    const investigation = await agent.investigate({
      ...BASE_REQUEST,
      observationDescription: "payment not processed",
    });

    expect(investigation.request.observationDescription).toBe("payment not processed");
  });
});
