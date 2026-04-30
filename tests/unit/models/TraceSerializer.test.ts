import { describe, it, expect } from "vitest";
import { TraceSerializer } from "../../../src/models/TraceSerializer.js";
import { Trace } from "../../../src/models/Trace.js";
import type { TraceEntry } from "../../../src/models/Investigation.js";

function makeEntry(id: string): TraceEntry {
  return {
    id,
    timestamp: "2026-04-30T10:00:00Z",
    type: "tool-call",
    toolName: "cloudwatch-logs",
    input: { query: "test" },
    output: { entries: [] },
    error: null,
    durationMs: 100,
    scanBytesUsed: 512,
  };
}

describe("TraceSerializer", () => {
  const serializer = new TraceSerializer();

  it("round-trips a trace through serialise/deserialise", () => {
    const trace = new Trace("inv-round-trip");
    trace.appendEntry(makeEntry("e-1"));
    trace.appendEntry(makeEntry("e-2"));

    const json = serializer.toJSON(trace);
    const restored = serializer.deserialize(json);

    expect(restored.investigationId).toBe("inv-round-trip");
    expect(restored.entries).toHaveLength(2);
    expect(restored.entries[0]?.id).toBe("e-1");
    expect(restored.entries[1]?.id).toBe("e-2");
  });

  it("serialised output includes schemaVersion", () => {
    const trace = new Trace("inv-version");
    const serialised = serializer.serialize(trace);
    expect(serialised.schemaVersion).toBe("1.0.0");
  });

  it("toTrace() reconstructs a Trace with entries", () => {
    const trace = new Trace("inv-1");
    trace.appendEntry(makeEntry("e-a"));
    const serialised = serializer.serialize(trace);
    const reconstructed = serializer.toTrace(serialised);

    expect(reconstructed.investigationId).toBe("inv-1");
    expect(reconstructed.getEntries()).toHaveLength(1);
    expect(reconstructed.getEntries()[0]?.id).toBe("e-a");
  });

  it("throws on invalid JSON input", () => {
    expect(() => serializer.deserialize("not json at all")).toThrow("invalid JSON");
  });

  it("throws when schemaVersion is missing", () => {
    const json = JSON.stringify({ investigationId: "inv-1", entries: [] });
    expect(() => serializer.deserialize(json)).toThrow("schemaVersion");
  });

  it("throws when entries is not an array", () => {
    const json = JSON.stringify({ schemaVersion: "1.0.0", investigationId: "inv-1", entries: "bad" });
    expect(() => serializer.deserialize(json)).toThrow("entries must be an array");
  });
});
