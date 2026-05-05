import { describe, it, expect } from "vitest";
import type { Report } from "../../src/models/Investigation.js";

function assertReportStructure(report: Report): void {
  expect(report.investigationId).toBeTruthy();
  expect(report.summary).toBeDefined();
  expect(report.summary.serviceId).toBeTruthy();
  expect(report.summary.environment).toBeTruthy();
  expect(report.summary.linkingKeys.length).toBeGreaterThan(0);
  expect(report.summary.timeWindow).toBeDefined();
  expect(typeof report.summary.defaultWindowApplied).toBe("boolean");
  expect(Array.isArray(report.timeline)).toBe(true);
  expect(typeof report.evidenceBySource).toBe("object");
  expect(Array.isArray(report.hypotheses)).toBe(true);
  expect(Array.isArray(report.recommendedActions)).toBe(true);
  expect(report.metadata).toBeDefined();
  expect(typeof report.metadata.toolCallsCount).toBe("number");
  expect(Array.isArray(report.metadata.dataSourcesQueried)).toBe(true);
  expect(Array.isArray(report.metadata.dataSourcesUnavailable)).toBe(true);
  expect(typeof report.metadata.scanBytesUsed).toBe("number");
  expect(typeof report.markdownContent).toBe("string");
  expect(report.markdownContent.length).toBeGreaterThan(0);
}

function assertObservationDescriptionInReport(
  report: Report,
  observationDescription: string,
): void {
  expect(report.summary.observationDescription).toBe(observationDescription);
  expect(report.markdownContent).toContain(observationDescription);
}

describe("[Structural Eval] Report structure", () => {
  it("has all required sections on a minimal report object", () => {
    const report: Report = {
      investigationId: "inv-001",
      summary: {
        serviceId: "order-service",
        environment: "prod",
        linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
        timeWindow: { from: "2026-04-30T10:00:00Z", to: "2026-04-30T11:00:00Z" },
        defaultWindowApplied: false,
      },
      timeline: [],
      evidenceBySource: {},
      hypotheses: [],
      likelyFailurePoint: null,
      recommendedActions: ["Check logs"],
      metadata: {
        toolCallsCount: 1,
        dataSourcesQueried: ["cloudwatch-logs"],
        dataSourcesUnavailable: [],
        logGroupsQueried: ["/ecs/booking-service/prod"],
        scanBytesUsed: 0,
        scanBudgetBytes: 1_073_741_824,
        resultsTruncated: false,
        uncertaintyFlags: [],
      },
      markdownContent: "# Investigation Report\n\nSome content.",
    };

    assertReportStructure(report);
  });

  it("observationDescription appears verbatim in summary and markdown when provided", () => {
    const desc = "customer did not receive notification email";
    const report: Report = {
      investigationId: "inv-002",
      summary: {
        serviceId: "notification-service",
        environment: "prod",
        linkingKeys: [{ type: "http-correlation", value: "trace-abc" }],
        timeWindow: { from: "2026-04-30T10:00:00Z", to: "2026-04-30T11:00:00Z" },
        defaultWindowApplied: false,
        observationDescription: desc,
      },
      timeline: [],
      evidenceBySource: {},
      hypotheses: [],
      likelyFailurePoint: null,
      recommendedActions: [],
      metadata: {
        toolCallsCount: 0,
        dataSourcesQueried: [],
        dataSourcesUnavailable: [],
        logGroupsQueried: [],
        scanBytesUsed: 0,
        scanBudgetBytes: 1_073_741_824,
        resultsTruncated: false,
        uncertaintyFlags: [],
      },
      markdownContent: `# Investigation Report\n\n**Observation**: ${desc}`,
    };

    assertReportStructure(report);
    assertObservationDescriptionInReport(report, desc);
  });
});
