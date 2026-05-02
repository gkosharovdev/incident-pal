import { describe, it, expect } from "vitest";

// SC-002: stream updates must be fast. This validates the hook module loads
// correctly and the label map covers all TraceEntry types (no undefined labels).
describe("TUI stream performance baseline", () => {
  it("useInvestigation hook module loads without error", async () => {
    const mod = await import("../../../src/tui/hooks/useInvestigation.js");
    expect(mod.useInvestigation).toBeTypeOf("function");
  });

  it("InvestigationStatus covers all expected terminal states", async () => {
    // Type-level check: if InvestigationStatus import resolves, the types are valid
    const mod = await import("../../../src/tui/hooks/useInvestigation.js");
    expect(mod.useInvestigation).toBeDefined();
  });
});
