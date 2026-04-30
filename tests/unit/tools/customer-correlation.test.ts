import { describe, it, expect, vi } from "vitest";
import { CustomerCorrelationTool } from "../../../src/tools/customer-correlation/CustomerCorrelationTool.js";

function makeClient(response: unknown, throws?: Error): { get: ReturnType<typeof vi.fn> } {
  if (throws) {
    return { get: vi.fn().mockRejectedValue(throws) };
  }
  return { get: vi.fn().mockResolvedValue(response) };
}

describe("CustomerCorrelationTool", () => {
  it("returns entity metadata on success", async () => {
    const responseData = { customerId: "cust-1", email: "test@example.com" };
    const client = makeClient(responseData);
    const tool = new CustomerCorrelationTool(client, "https://api.example.com");

    const result = await tool.invoke({ entityType: "order", entityId: "ord-1" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(responseData);
    expect(client.get).toHaveBeenCalledWith(
      "https://api.example.com/entities/order/ord-1",
    );
  });

  it("returns error on HTTP failure", async () => {
    const client = makeClient(null, new Error("connection refused"));
    const tool = new CustomerCorrelationTool(client, "https://api.example.com");

    const result = await tool.invoke({ entityType: "customer", entityId: "cust-1" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("connection refused");
  });

  it("encodes special characters in entity type and id", async () => {
    const client = makeClient({ id: "x" });
    const tool = new CustomerCorrelationTool(client, "https://api.example.com");

    await tool.invoke({ entityType: "payment/charge", entityId: "pmt 123" });

    expect(client.get).toHaveBeenCalledWith(
      "https://api.example.com/entities/payment%2Fcharge/pmt%20123",
    );
  });
});
