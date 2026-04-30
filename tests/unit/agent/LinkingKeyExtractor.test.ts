import { describe, it, expect } from "vitest";
import { LinkingKeyExtractor } from "../../../src/agent/LinkingKeyExtractor.js";
import type { LinkingKeySchema } from "../../../src/agent/LinkingKeyExtractor.js";

const FULL_SCHEMA: LinkingKeySchema = {
  orderId: "entity-id",
  traceId: "http-correlation",
  messageId: "kafka-message-id",
};

describe("LinkingKeyExtractor", () => {
  const extractor = new LinkingKeyExtractor();

  it("extracts entity-id from matching field", () => {
    const keys = extractor.extract({ orderId: "ord-1" }, FULL_SCHEMA, "order");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ type: "entity-id", entityType: "order", value: "ord-1" });
  });

  it("extracts http-correlation from matching field", () => {
    const keys = extractor.extract({ traceId: "trace-abc" }, FULL_SCHEMA, "order");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ type: "http-correlation", value: "trace-abc" });
  });

  it("extracts kafka-message-id from matching field", () => {
    const keys = extractor.extract({ messageId: "msg-xyz" }, FULL_SCHEMA, "order");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ type: "kafka-message-id", value: "msg-xyz" });
  });

  it("extracts all three types when all fields present", () => {
    const keys = extractor.extract(
      { orderId: "ord-1", traceId: "trace-abc", messageId: "msg-xyz" },
      FULL_SCHEMA,
      "order",
    );
    expect(keys).toHaveLength(3);
  });

  it("ignores fields not in schema", () => {
    const keys = extractor.extract(
      { unrelated: "value", irrelevant: "other" },
      FULL_SCHEMA,
      "order",
    );
    expect(keys).toHaveLength(0);
  });

  it("ignores empty string field values", () => {
    const keys = extractor.extract({ orderId: "" }, FULL_SCHEMA, "order");
    expect(keys).toHaveLength(0);
  });

  it("ignores non-string field values", () => {
    const keys = extractor.extract({ orderId: 12345 }, FULL_SCHEMA, "order");
    expect(keys).toHaveLength(0);
  });

  it("returns empty array for non-object log entry", () => {
    expect(extractor.extract(null, FULL_SCHEMA, "order")).toHaveLength(0);
    expect(extractor.extract("plain string", FULL_SCHEMA, "order")).toHaveLength(0);
  });

  it("extractFromEntries aggregates keys across multiple entries", () => {
    const entries = [
      { orderId: "ord-1" },
      { traceId: "trace-2" },
      { messageId: "msg-3" },
    ];
    const keys = extractor.extractFromEntries(entries, FULL_SCHEMA, "order");
    expect(keys).toHaveLength(3);
  });
});
