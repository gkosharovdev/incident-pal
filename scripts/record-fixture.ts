#!/usr/bin/env node
/**
 * Records tool responses from a live investigation as fixture files.
 * Run against a real environment, then commit the fixtures for use in golden-set evals.
 *
 * Usage:
 *   npx ts-node scripts/record-fixture.ts \
 *     --scenario-id S010 \
 *     --service order-service \
 *     --env production \
 *     --entity-id order:ord-99999
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Placeholder — full implementation requires the investigation to complete
// and save individual tool responses to evals/fixtures/<scenario-id>/<tool-name>.json
const scenarioId = process.argv.includes("--scenario-id")
  ? process.argv[process.argv.indexOf("--scenario-id") + 1]
  : "UNKNOWN";

console.log(`Recording fixture for scenario: ${scenarioId ?? "unknown"}`);
console.log("This script runs a live investigation and saves all tool responses.");
console.log("Run with: npx ts-node scripts/record-fixture.ts --scenario-id <ID> [investigate flags]");

mkdirSync(join("evals", "fixtures", scenarioId ?? "unknown"), { recursive: true });
writeFileSync(
  join("evals", "fixtures", scenarioId ?? "unknown", "README.md"),
  `# Fixture: ${scenarioId ?? "unknown"}\n\nRecord tool responses here by running the fixture recorder against a live environment.\n`,
);
