import { describe, it, expect } from "vitest";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";
import { LinkingKeySet } from "../../src/models/LinkingKey.js";
import { LinkingKeyExtractor } from "../../src/agent/LinkingKeyExtractor.js";

describe("[Structural Eval] Linking key discovery", () => {
  it("linking-key-discovered TraceEntry recorded each time a new linking key is found", () => {
    const trace = new Trace("inv-001");

    const discoveryEntry: TraceEntry = {
      id: "disc-1",
      timestamp: new Date().toISOString(),
      type: "linking-key-discovered",
      toolName: null,
      input: { discoveredFrom: "cloudwatch-logs" },
      output: { type: "entity-id", entityType: "order", value: "ord-5" },
      error: null,
      durationMs: 0,
      scanBytesUsed: null,
    };
    trace.appendEntry(discoveryEntry);

    const discoveryEntries = trace.getEntries().filter((e) => e.type === "linking-key-discovered");
    expect(discoveryEntries).toHaveLength(1);
    const output = discoveryEntries[0]?.output as { type: string; value: string };
    expect(output.value).toBe("ord-5");
  });

  it("LinkingKeyExtractor finds all three linking key types from a log entry", () => {
    const extractor = new LinkingKeyExtractor();
    const schema = {
      orderId: "entity-id" as const,
      traceId: "http-correlation" as const,
      messageId: "kafka-message-id" as const,
    };
    const logEntry = {
      orderId: "ord-1",
      traceId: "trace-abc",
      messageId: "msg-xyz",
      unrelated: "value",
    };

    const keys = extractor.extract(logEntry, schema, "order");
    expect(keys).toHaveLength(3);
    expect(keys.some((k) => k.type === "entity-id" && k.value === "ord-1")).toBe(true);
    expect(keys.some((k) => k.type === "http-correlation" && k.value === "trace-abc")).toBe(true);
    expect(keys.some((k) => k.type === "kafka-message-id" && k.value === "msg-xyz")).toBe(true);
  });

  it("LinkingKeySet does not add duplicate keys", () => {
    const set = new LinkingKeySet();
    const key = { type: "entity-id" as const, entityType: "order", value: "ord-1" };
    set.add(key);
    const added = set.add(key);
    expect(added).toBe(false);
    expect(set.size).toBe(1);
  });
});
