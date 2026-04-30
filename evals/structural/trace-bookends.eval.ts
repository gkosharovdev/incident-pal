import { describe, it, expect } from "vitest";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";

describe("[Structural Eval] Trace bookends", () => {
  it("first entry is investigation-started and last is investigation-complete", () => {
    const trace = new Trace("inv-bookends");

    const bookend = (type: TraceEntry["type"]): TraceEntry => ({
      id: `${type}-id`,
      timestamp: new Date().toISOString(),
      type,
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: 0,
      scanBytesUsed: null,
    });

    trace.appendEntry(bookend("investigation-started"));
    trace.appendEntry({
      id: "tool-1",
      timestamp: new Date().toISOString(),
      type: "tool-call",
      toolName: "cloudwatch-logs",
      input: {},
      output: {},
      error: null,
      durationMs: 200,
      scanBytesUsed: 512,
    });
    trace.appendEntry(bookend("investigation-complete"));

    const entries = trace.getEntries();
    expect(entries[0]?.type).toBe("investigation-started");
    expect(entries[entries.length - 1]?.type).toBe("investigation-complete");
  });

  it("timed-out is acceptable as the last entry in a timed-out investigation", () => {
    const trace = new Trace("inv-timed-out");

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
      id: "timeout",
      timestamp: new Date().toISOString(),
      type: "timed-out",
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: 600_000,
      scanBytesUsed: null,
    });

    const entries = trace.getEntries();
    const lastType = entries[entries.length - 1]?.type;
    expect(["investigation-complete", "timed-out"]).toContain(lastType);
  });
});
