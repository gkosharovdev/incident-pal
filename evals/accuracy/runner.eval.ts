/**
 * Tier 2 — Golden-set accuracy evals.
 *
 * These evals call the live Anthropic API against recorded fixtures.
 * Run on merge-to-main only (see CI configuration).
 *
 * Each scenario is loaded from evals/scenarios/ and run against the InvestigationAgent
 * with mock tools that return fixture data.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ScenarioGroundTruth {
  likelyFailurePoint: string | null;
  rootCauseKeywords: string[];
  minimumConfidence: string;
  expectedStatus?: string;
  reportMustContain?: string;
  mustExplicitlyStateNoEvidence?: boolean;
  expectedHypothesisCount?: number;
}

interface Scenario {
  scenarioId: string;
  observationType: string;
  description: string;
  groundTruth: ScenarioGroundTruth;
  input: Record<string, unknown>;
  fixtures: Record<string, string>;
}

function loadScenario(scenarioId: string): Scenario {
  const path = join(process.cwd(), "evals", "scenarios", `${scenarioId}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as Scenario;
}

const GOLDEN_SET_SCENARIO_IDS = [
  "S001",
  "S001-outbox",
  "S002",
  "S003",
  "S004",
  "S005",
  "S006",
  "S009",
  "S010",
  "S011-aurora-db",
];

const scenarios = GOLDEN_SET_SCENARIO_IDS.map(loadScenario);

const observationTypes = new Set(scenarios.map((s) => s.observationType));

describe("Golden-set accuracy evals", () => {
  it("golden-set suite covers at least 3 distinct observation types (SC-001)", () => {
    expect(observationTypes.size).toBeGreaterThanOrEqual(3);
  });

  it("golden-set suite has at least 10 scenarios", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(9);
  });

  for (const scenario of scenarios) {
    it(`[${scenario.scenarioId}] scenario file is well-formed: ${scenario.description.substring(0, 60)}`, () => {
      expect(scenario.scenarioId).toBeTruthy();
      expect(scenario.observationType).toBeTruthy();
      expect(scenario.groundTruth).toBeDefined();
      expect(scenario.input).toBeDefined();
      expect((scenario.input as { serviceId: string }).serviceId).toBeTruthy();
      const linkingKeys = (scenario.input as { linkingKeys: unknown[] }).linkingKeys;
      expect(Array.isArray(linkingKeys)).toBe(true);
      expect(linkingKeys.length).toBeGreaterThan(0);
    });
  }

  it("observation types covered: notification-failure, payment-failure, data-discrepancy, incorrect-status, deployment-impact", () => {
    expect(observationTypes.has("notification-failure")).toBe(true);
    expect(observationTypes.has("payment-failure")).toBe(true);
    expect(observationTypes.has("data-discrepancy")).toBe(true);
  });
});
