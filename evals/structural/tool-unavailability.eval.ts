import { describe, it, expect } from "vitest";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";

describe("[Structural Eval] Tool unavailability handling", () => {
  it("tool-unavailable trace entry is recorded when a tool cannot be reached", () => {
    const trace = new Trace("inv-001");

    const unavailableEntry: TraceEntry = {
      id: "unavail-1",
      timestamp: new Date().toISOString(),
      type: "tool-unavailable",
      toolName: "email-delivery-status",
      input: { entityId: "cust-1" },
      output: null,
      error: "Connection refused: email-delivery-status service unavailable",
      durationMs: 50,
      scanBytesUsed: null,
    };
    trace.appendEntry(unavailableEntry);

    const unavailableEntries = trace.getEntries().filter((e) => e.type === "tool-unavailable");
    expect(unavailableEntries).toHaveLength(1);
    expect(unavailableEntries[0]?.toolName).toBe("email-delivery-status");
    expect(unavailableEntries[0]?.error).toBeTruthy();
  });

  it("tool-error trace entry captures error details", () => {
    const trace = new Trace("inv-002");

    const errorEntry: TraceEntry = {
      id: "err-1",
      timestamp: new Date().toISOString(),
      type: "tool-error",
      toolName: "cloudwatch-logs",
      input: { logGroup: "/ecs/svc/prod", query: "fields @message" },
      output: null,
      error: "ThrottlingException: Rate exceeded",
      durationMs: 100,
      scanBytesUsed: null,
    };
    trace.appendEntry(errorEntry);

    const errEntries = trace.getEntries().filter((e) => e.type === "tool-error");
    expect(errEntries).toHaveLength(1);
    expect(errEntries[0]?.error).toContain("ThrottlingException");
  });
});
