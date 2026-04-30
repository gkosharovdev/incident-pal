import { describe, it, expect } from "vitest";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";

describe("[Structural Eval] Trace persistence", () => {
  it("serialised trace contains all required TraceEntry fields", () => {
    const trace = new Trace("inv-persist");
    const entry: TraceEntry = {
      id: "e-1",
      timestamp: "2026-04-30T10:00:00Z",
      type: "tool-call",
      toolName: "cloudwatch-logs",
      input: { logGroup: "/ecs/svc/prod", query: "fields @message" },
      output: { entries: [] },
      error: null,
      durationMs: 250,
      scanBytesUsed: 1024,
    };
    trace.appendEntry(entry);

    const serialised = JSON.stringify({
      investigationId: trace.investigationId,
      schemaVersion: "1.0.0",
      entries: trace.getEntries(),
    });

    const parsed = JSON.parse(serialised) as {
      investigationId: string;
      schemaVersion: string;
      entries: TraceEntry[];
    };

    expect(parsed.investigationId).toBe("inv-persist");
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.entries).toHaveLength(1);

    const storedEntry = parsed.entries[0]!;
    expect(storedEntry).toHaveProperty("id");
    expect(storedEntry).toHaveProperty("timestamp");
    expect(storedEntry).toHaveProperty("type");
    expect(storedEntry).toHaveProperty("toolName");
    expect(storedEntry).toHaveProperty("durationMs");
  });
});
