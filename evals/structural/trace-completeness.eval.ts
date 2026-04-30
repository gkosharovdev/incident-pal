import { describe, it, expect } from "vitest";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";

describe("[Structural Eval] Trace completeness", () => {
  it("every tool call must have a TraceEntry with matching toolName", () => {
    const trace = new Trace("inv-001");

    const toolCallsExecuted = ["cloudwatch-logs", "ecs-deployment"];

    for (const toolName of toolCallsExecuted) {
      const entry: TraceEntry = {
        id: `entry-${toolName}`,
        timestamp: new Date().toISOString(),
        type: "tool-call",
        toolName,
        input: { query: "test" },
        output: { result: "ok" },
        error: null,
        durationMs: 100,
        scanBytesUsed: null,
      };
      trace.appendEntry(entry);
    }

    const toolCallEntries = trace
      .getEntries()
      .filter((e) => e.type === "tool-call")
      .map((e) => e.toolName);

    for (const toolName of toolCallsExecuted) {
      expect(toolCallEntries).toContain(toolName);
    }
  });

  it("trace has investigation-started as first entry and investigation-complete as last", () => {
    const trace = new Trace("inv-001");

    trace.appendEntry({
      id: "start",
      timestamp: new Date().toISOString(),
      type: "investigation-started",
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: 0,
      scanBytesUsed: null,
    });

    trace.appendEntry({
      id: "tool",
      timestamp: new Date().toISOString(),
      type: "tool-call",
      toolName: "cloudwatch-logs",
      input: {},
      output: {},
      error: null,
      durationMs: 200,
      scanBytesUsed: 1024,
    });

    trace.appendEntry({
      id: "complete",
      timestamp: new Date().toISOString(),
      type: "investigation-complete",
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: 0,
      scanBytesUsed: null,
    });

    const entries = trace.getEntries();
    expect(entries[0]?.type).toBe("investigation-started");
    expect(entries[entries.length - 1]?.type).toBe("investigation-complete");
  });
});
