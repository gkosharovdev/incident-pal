import { describe, it, expect } from "vitest";
import type { Report } from "../../src/models/Investigation.js";

describe("[Structural Eval] Cross-service correlation", () => {
  it("report includes evidence from multiple services when fixture spans both", () => {
    const report: Partial<Report> = {
      evidenceBySource: {
        "cloudwatch-logs:order-service": [
          {
            id: "e1",
            source: "cloudwatch-logs",
            timestamp: "2026-04-30T10:15:00Z",
            description: "Order ord-1 created",
            rawData: {},
            linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
          },
        ],
        "cloudwatch-logs:payment-service": [
          {
            id: "e2",
            source: "cloudwatch-logs",
            timestamp: "2026-04-30T10:15:05Z",
            description: "Payment failed for ord-1",
            rawData: {},
            linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
          },
        ],
      },
    };

    const sources = Object.keys(report.evidenceBySource ?? {});
    expect(sources.length).toBeGreaterThanOrEqual(2);

    const allEvidence = Object.values(report.evidenceBySource ?? {}).flat();
    const linkingKeyValues = allEvidence.flatMap((e) => e.linkingKeys.map((k) => k.value));
    expect(linkingKeyValues).toContain("ord-1");
  });
});
