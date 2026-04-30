import { describe, it, expect } from "vitest";
import { Trace } from "../../../src/models/Trace.js";
import type { TraceEntry } from "../../../src/models/Investigation.js";

function makeEntry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    id: "test-id",
    timestamp: new Date().toISOString(),
    type: "tool-call",
    toolName: "test-tool",
    input: { query: "test" },
    output: { result: "ok" },
    error: null,
    durationMs: 100,
    scanBytesUsed: null,
    ...overrides,
  };
}

describe("Trace", () => {
  it("starts empty", () => {
    const trace = new Trace("inv-1");
    expect(trace.getEntries()).toHaveLength(0);
    expect(trace.length).toBe(0);
  });

  it("appends entries in order", () => {
    const trace = new Trace("inv-1");
    trace.appendEntry(makeEntry({ id: "a" }));
    trace.appendEntry(makeEntry({ id: "b" }));
    const entries = trace.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).toBe("a");
    expect(entries[1]?.id).toBe("b");
  });

  it("returns frozen (immutable) entries", () => {
    const trace = new Trace("inv-1");
    const entry = makeEntry({ id: "a" });
    trace.appendEntry(entry);
    const stored = trace.getEntries()[0];
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it("stores investigationId", () => {
    const trace = new Trace("inv-abc");
    expect(trace.investigationId).toBe("inv-abc");
  });
});
