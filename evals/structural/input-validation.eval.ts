import { describe, it, expect } from "vitest";
import { investigationRequestSchema } from "../../src/models/validation.js";

describe("[Structural Eval] Input validation", () => {
  it("rejects unknown service at schema level (empty serviceId)", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "trace-1" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects request with no linking keys", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "order-service",
      environment: "prod",
      linkingKeys: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid environment value", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "order-service",
      environment: "unknown-env",
      linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid request with all three linking key types", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "order-service",
      environment: "prod",
      linkingKeys: [
        { type: "entity-id", entityType: "order", value: "ord-1" },
        { type: "http-correlation", value: "trace-abc" },
        { type: "kafka-message-id", value: "msg-xyz" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
