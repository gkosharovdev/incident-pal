import { describe, it, expect } from "vitest";
import { investigationRequestSchema } from "../../../src/models/validation.js";

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST_FROM = "2026-04-30T10:00:00.000Z";
const PAST_TO = "2026-04-30T11:00:00.000Z";

describe("investigationRequestSchema", () => {
  it("accepts a minimal valid request", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "order-service",
      environment: "prod",
      linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts all linking key types", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "dev",
      linkingKeys: [
        { type: "entity-id", entityType: "order", value: "ord-1" },
        { type: "http-correlation", value: "trace-abc" },
        { type: "kafka-message-id", value: "msg-xyz" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty serviceId", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty linkingKeys array", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "prod",
      linkingKeys: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid environment", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "staging",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeWindow where from >= to", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
      timeWindow: { from: PAST_TO, to: PAST_FROM },
    });
    expect(result.success).toBe(false);
  });

  it("rejects future to in timeWindow", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
      timeWindow: { from: PAST_FROM, to: FUTURE },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional observationDescription up to 500 chars", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
      observationDescription: "payment not processed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects observationDescription over 500 chars", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
      observationDescription: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid timeWindow", () => {
    const result = investigationRequestSchema.safeParse({
      serviceId: "svc",
      environment: "prod",
      linkingKeys: [{ type: "http-correlation", value: "t" }],
      timeWindow: { from: PAST_FROM, to: PAST_TO },
    });
    expect(result.success).toBe(true);
  });
});
