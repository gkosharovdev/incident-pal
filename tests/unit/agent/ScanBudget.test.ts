import { describe, it, expect } from "vitest";
import { ScanBudget } from "../../../src/agent/ScanBudget.js";

describe("ScanBudget", () => {
  it("can afford within budget", () => {
    const budget = new ScanBudget(1000);
    expect(budget.canAfford(500)).toBe(true);
  });

  it("cannot afford over budget", () => {
    const budget = new ScanBudget(1000);
    expect(budget.canAfford(1001)).toBe(false);
  });

  it("tracks used bytes after record()", () => {
    const budget = new ScanBudget(1000);
    budget.record(400);
    expect(budget.used).toBe(400);
    expect(budget.remaining).toBe(600);
  });

  it("becomes exhausted when budget reached", () => {
    const budget = new ScanBudget(500);
    budget.record(500);
    expect(budget.isExhausted).toBe(true);
  });

  it("remaining never goes below 0", () => {
    const budget = new ScanBudget(100);
    budget.record(200);
    expect(budget.remaining).toBe(0);
  });

  it("accumulates across multiple record() calls", () => {
    const budget = new ScanBudget(1000);
    budget.record(300);
    budget.record(300);
    expect(budget.canAfford(401)).toBe(false);
    expect(budget.canAfford(400)).toBe(true);
  });
});
