import { describe, it, expect } from "vitest";
import { ReportRenderer } from "../../../src/report/ReportRenderer.js";
import { Trace } from "../../../src/models/Trace.js";
import { LinkingKeySet } from "../../../src/models/LinkingKey.js";
import type { Investigation, ReportMetadata } from "../../../src/models/Investigation.js";

function makeInvestigation(overrides: Partial<Investigation> = {}): Investigation {
  const trace = new Trace("inv-test");
  const activeLinkingKeys = new LinkingKeySet();
  activeLinkingKeys.add({ type: "entity-id", entityType: "order", value: "ord-1" });

  return {
    id: "inv-test",
    request: {
      serviceId: "order-service",
      environment: "prod",
      linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
      timeWindow: {
        from: "2026-04-30T10:00:00Z",
        to: "2026-04-30T11:00:00Z",
      },
    },
    status: "complete",
    activeLinkingKeys,
    trace,
    hypotheses: [],
    report: null,
    startedAt: "2026-04-30T10:00:00Z",
    completedAt: "2026-04-30T10:05:00Z",
    ...overrides,
  };
}

const EMPTY_METADATA: ReportMetadata = {
  toolCallsCount: 0,
  dataSourcesQueried: [],
  dataSourcesUnavailable: [],
  logGroupsQueried: [],
  scanBytesUsed: 0,
  scanBudgetBytes: 1_073_741_824,
  resultsTruncated: false,
  uncertaintyFlags: [],
};

describe("ReportRenderer", () => {
  const renderer = new ReportRenderer();

  it("renders a report with all required sections", () => {
    const investigation = makeInvestigation();
    const report = renderer.render(investigation, {}, EMPTY_METADATA);

    expect(report.markdownContent).toContain("# Investigation Report");
    expect(report.markdownContent).toContain("## Summary");
    expect(report.markdownContent).toContain("## Evidence");
    expect(report.markdownContent).toContain("## Hypotheses");
    expect(report.markdownContent).toContain("## Likely Failure Point");
    expect(report.markdownContent).toContain("## Recommended Next Actions");
    expect(report.markdownContent).toContain("## Investigation Metadata");
  });

  it("includes observationDescription verbatim in report when provided", () => {
    const desc = "payment not processed for order ord-1";
    const investigation = makeInvestigation({
      request: {
        serviceId: "payment-service",
        environment: "prod",
        linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
        timeWindow: { from: "2026-04-30T10:00:00Z", to: "2026-04-30T11:00:00Z" },
        observationDescription: desc,
      },
    });
    const report = renderer.render(investigation, {}, EMPTY_METADATA);

    expect(report.summary.observationDescription).toBe(desc);
    expect(report.markdownContent).toContain(desc);
  });

  it("emits timeout warning as first section when status is timed-out", () => {
    const investigation = makeInvestigation({ status: "timed-out" });
    const report = renderer.render(investigation, {}, EMPTY_METADATA);

    expect(report.markdownContent.startsWith("## ⚠️ Investigation Timed Out")).toBe(true);
  });

  it("sets defaultWindowApplied to true when no timeWindow in request", () => {
    const investigation = makeInvestigation({
      request: {
        serviceId: "order-service",
        environment: "prod",
        linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-1" }],
      },
    });
    const report = renderer.render(investigation, {}, EMPTY_METADATA);
    expect(report.summary.defaultWindowApplied).toBe(true);
  });

  it("likelyFailurePoint is null when no hypotheses exist", () => {
    const investigation = makeInvestigation({ hypotheses: [] });
    const report = renderer.render(investigation, {}, EMPTY_METADATA);
    expect(report.likelyFailurePoint).toBeNull();
  });

  it("likelyFailurePoint is the highest-confidence hypothesis", () => {
    const investigation = makeInvestigation({
      hypotheses: [
        {
          id: "h1",
          description: "Low confidence guess",
          confidence: "low",
          supportingEvidence: [],
          contradictingEvidence: [],
        },
        {
          id: "h2",
          description: "High confidence finding",
          confidence: "high",
          supportingEvidence: [],
          contradictingEvidence: [],
        },
      ],
    });
    const report = renderer.render(investigation, {}, EMPTY_METADATA);

    expect(report.likelyFailurePoint?.description).toBe("High confidence finding");
    expect(report.likelyFailurePoint?.confidence).toBe("high");
  });

  it("notes truncation in metadata section when resultsTruncated is true", () => {
    const metadata: ReportMetadata = { ...EMPTY_METADATA, resultsTruncated: true };
    const investigation = makeInvestigation();
    const report = renderer.render(investigation, {}, metadata);

    expect(report.markdownContent).toContain("truncated");
  });
});
