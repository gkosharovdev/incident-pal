import { describe, it, expect, vi } from "vitest";
import { NotificationOutboxTool } from "../../../src/tools/extensions/notification-outbox/NotificationOutboxTool.js";
import { ToolRegistry } from "../../../src/agent/ToolRegistry.js";

function makeOutboxClient(records: unknown[]): { get: ReturnType<typeof vi.fn> } {
  return { get: vi.fn().mockResolvedValue(records) };
}

describe("NotificationOutboxTool integration", () => {
  it("registers in ToolRegistry and is invokable", async () => {
    const records = [
      {
        notificationId: "notif-1",
        customerId: "cust-42",
        type: "order_confirmation",
        status: "failed",
        queuedAt: "2026-04-30T10:15:00Z",
        dispatchedAt: null,
        failureReason: "smtp-relay unavailable",
        retryCount: 3,
      },
    ];

    const client = makeOutboxClient(records);
    const tool = new NotificationOutboxTool(client, "https://outbox.example.com");

    const registry = new ToolRegistry();
    registry.register(tool);

    expect(registry.lookup("notification-outbox")).toBeDefined();

    const result = await registry.lookup("notification-outbox")!.invoke({
      linkingKey: "cust-42",
      linkingKeyType: "customer-id",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(true);
    const data = result.data as Array<{ status: string }>;
    expect(data).toHaveLength(1);
    expect(data[0]?.status).toBe("failed");
  });

  it("returns error when outbox service is unreachable", async () => {
    const client = { get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const tool = new NotificationOutboxTool(client, "https://outbox.example.com");

    const result = await tool.invoke({
      linkingKey: "cust-1",
      linkingKeyType: "customer-id",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("appears in LLM tool definitions list", () => {
    const client = makeOutboxClient([]);
    const tool = new NotificationOutboxTool(client, "https://outbox.example.com");
    const registry = new ToolRegistry();
    registry.register(tool);

    const defs = registry.getToolDefinitions();
    const def = defs.find((d) => d.name === "notification-outbox");
    expect(def).toBeDefined();
    expect(def?.description).toContain("outbox");
  });
});
