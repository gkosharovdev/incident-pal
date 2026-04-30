import { describe, it, expect } from "vitest";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";

describe("[Structural Eval] Tool error recovery", () => {
  it("tool-error entry recorded when a registered tool throws", () => {
    const trace = new Trace("inv-error-recovery");

    const errorEntry: TraceEntry = {
      id: "err-1",
      timestamp: new Date().toISOString(),
      type: "tool-error",
      toolName: "notification-outbox",
      input: { customerId: "cust-42" },
      output: null,
      error: "ECONNREFUSED: outbox service unreachable",
      durationMs: 50,
      scanBytesUsed: null,
    };
    trace.appendEntry(errorEntry);

    const errorEntries = trace.getEntries().filter((e) => e.type === "tool-error");
    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]?.error).toContain("ECONNREFUSED");

    const afterToolCall: TraceEntry = {
      id: "next-1",
      timestamp: new Date().toISOString(),
      type: "tool-call",
      toolName: "cloudwatch-logs",
      input: { logGroup: "/ecs/svc/prod", query: "fields @message" },
      output: { entries: [] },
      error: null,
      durationMs: 200,
      scanBytesUsed: 0,
    };
    trace.appendEntry(afterToolCall);

    expect(trace.getEntries()).toHaveLength(2);
    expect(trace.getEntries()[1]?.type).toBe("tool-call");
  });
});
