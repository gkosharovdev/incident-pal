import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface EvalResult {
  scenarioId: string;
  observationType: string;
  passed: boolean;
  failureReason?: string;
}

interface ResultsSummary {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  observationTypesCovered: string[];
  results: EvalResult[];
}

function loadResults(): EvalResult[] {
  const resultsDir = join(process.cwd(), "evals", "results");
  if (!existsSync(resultsDir)) return [];

  const files = readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
  return files.flatMap((f) => {
    try {
      return JSON.parse(readFileSync(join(resultsDir, f), "utf-8")) as EvalResult[];
    } catch {
      return [];
    }
  });
}

function summarise(results: EvalResult[]): ResultsSummary {
  const passed = results.filter((r) => r.passed).length;
  const observationTypesCovered = [...new Set(results.map((r) => r.observationType))];

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    observationTypesCovered,
    results,
  };
}

function main(): void {
  const results = loadResults();
  const summary = summarise(results);

  console.log("\n=== Accuracy Eval Report ===\n");
  console.log(`Total scenarios: ${summary.total}`);
  console.log(`Passed:          ${summary.passed}`);
  console.log(`Failed:          ${summary.failed}`);
  console.log(`Accuracy:        ${(summary.accuracy * 100).toFixed(1)}%`);
  console.log(`Observation types covered: ${summary.observationTypesCovered.join(", ")}`);

  if (summary.results.length > 0) {
    console.log("\nPer-scenario results:");
    for (const result of summary.results) {
      const icon = result.passed ? "✅" : "❌";
      console.log(`  ${icon} ${result.scenarioId} [${result.observationType}]`);
      if (!result.passed && result.failureReason) {
        console.log(`     Reason: ${result.failureReason}`);
      }
    }
  }

  console.log("");

  const ACCURACY_THRESHOLD = 0.8;
  const MIN_OBSERVATION_TYPES = 3;

  if (summary.total > 0 && summary.accuracy < ACCURACY_THRESHOLD) {
    console.error(
      `❌ Accuracy ${(summary.accuracy * 100).toFixed(1)}% is below threshold of ${ACCURACY_THRESHOLD * 100}%`,
    );
    process.exit(1);
  }

  if (summary.observationTypesCovered.length < MIN_OBSERVATION_TYPES) {
    console.error(
      `❌ Only ${summary.observationTypesCovered.length} observation types covered — need at least ${MIN_OBSERVATION_TYPES}`,
    );
    process.exit(1);
  }

  console.log("✅ All accuracy gates passed");
}

main();
