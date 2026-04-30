import { describe, it, expect } from "vitest";
import { InvestigationTimer } from "../../../src/agent/InvestigationTimer.js";

describe("InvestigationTimer", () => {
  it("is not expired immediately after creation", () => {
    const timer = new InvestigationTimer(60_000);
    expect(timer.isExpired()).toBe(false);
  });

  it("is expired when maxDurationMs is 0", () => {
    const timer = new InvestigationTimer(0);
    expect(timer.isExpired()).toBe(true);
  });

  it("remaining is approximately maxDurationMs at start", () => {
    const timer = new InvestigationTimer(60_000);
    expect(timer.remainingMs()).toBeGreaterThan(59_900);
    expect(timer.remainingMs()).toBeLessThanOrEqual(60_000);
  });

  it("remaining is 0 when expired", () => {
    const timer = new InvestigationTimer(0);
    expect(timer.remainingMs()).toBe(0);
  });

  it("elapsed increases over time", async () => {
    const timer = new InvestigationTimer(60_000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(timer.elapsedMs()).toBeGreaterThan(0);
  });
});
