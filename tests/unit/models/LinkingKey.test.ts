import { describe, it, expect } from "vitest";
import { LinkingKeySet, linkingKeyId } from "../../../src/models/LinkingKey.js";

describe("linkingKeyId", () => {
  it("formats entity-id keys", () => {
    expect(linkingKeyId({ type: "entity-id", entityType: "order", value: "ord-1" })).toBe(
      "entity-id:order:ord-1",
    );
  });

  it("formats http-correlation keys", () => {
    expect(linkingKeyId({ type: "http-correlation", value: "abc-123" })).toBe(
      "http-correlation:abc-123",
    );
  });

  it("formats kafka-message-id keys", () => {
    expect(linkingKeyId({ type: "kafka-message-id", value: "msg-xyz" })).toBe(
      "kafka-message-id:msg-xyz",
    );
  });
});

describe("LinkingKeySet", () => {
  it("starts empty", () => {
    const set = new LinkingKeySet();
    expect(set.size).toBe(0);
  });

  it("adds a key and reports it present", () => {
    const set = new LinkingKeySet();
    const key = { type: "entity-id" as const, entityType: "order", value: "ord-1" };
    const added = set.add(key);
    expect(added).toBe(true);
    expect(set.has(key)).toBe(true);
    expect(set.size).toBe(1);
  });

  it("deduplicates identical keys", () => {
    const set = new LinkingKeySet();
    const key = { type: "http-correlation" as const, value: "trace-1" };
    set.add(key);
    const addedAgain = set.add(key);
    expect(addedAgain).toBe(false);
    expect(set.size).toBe(1);
  });

  it("handles multiple key types independently", () => {
    const set = new LinkingKeySet();
    set.add({ type: "entity-id", entityType: "order", value: "ord-1" });
    set.add({ type: "http-correlation", value: "trace-1" });
    set.add({ type: "kafka-message-id", value: "msg-1" });
    expect(set.size).toBe(3);
  });

  it("snapshot returns all keys", () => {
    const set = new LinkingKeySet();
    const k1 = { type: "entity-id" as const, entityType: "order", value: "ord-1" };
    const k2 = { type: "http-correlation" as const, value: "trace-1" };
    set.add(k1);
    set.add(k2);
    const snap = set.snapshot();
    expect(snap).toHaveLength(2);
  });
});
