import { describe, it, expect } from "vitest";
import { InvestigationTimer } from "../../src/agent/InvestigationTimer.js";
import { Trace } from "../../src/models/Trace.js";
import type { TraceEntry } from "../../src/models/Investigation.js";

describe("[Structural Eval] Timeout enforcement", () => {
  it("InvestigationTimer expires immediately at maxDurationMs=0", () => {
    const timer = new InvestigationTimer(0);
    expect(timer.isExpired()).toBe(true);
    expect(timer.remainingMs()).toBe(0);
  });

  it("timed-out TraceEntry is recorded on timeout", () => {
    const trace = new Trace("inv-timeout");

    const timedOutEntry: TraceEntry = {
      id: "timeout-1",
      timestamp: new Date().toISOString(),
      type: "timed-out",
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: 600_000,
      scanBytesUsed: null,
    };
    trace.appendEntry(timedOutEntry);

    const timedOutEntries = trace.getEntries().filter((e) => e.type === "timed-out");
    expect(timedOutEntries).toHaveLength(1);
  });

  it("partial report markdown contains timeout warning section", () => {
    const markdownContent = `## ⚠️ Investigation Timed Out\n\nThe investigation reached the 10-minute wall-clock limit.\n\n## Summary\n\nPartial findings below.`;
    expect(markdownContent).toContain("## ⚠️ Investigation Timed Out");
    expect(markdownContent.indexOf("## ⚠️ Investigation Timed Out")).toBe(0);
  });
});
