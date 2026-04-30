import { describe, it, expect } from "vitest";
import type { Report } from "../../src/models/Investigation.js";

describe("[Structural Eval] observationDescription verbatim in report", () => {
  it("observationDescription appears verbatim in report.structured.summary.observationDescription", () => {
    const desc = "payment not processed for order ord-12345";

    const report: Partial<Report> & { summary: { observationDescription?: string } } = {
      investigationId: "inv-001",
      summary: {
        serviceId: "payment-service",
        environment: "production",
        linkingKeys: [{ type: "entity-id", entityType: "order", value: "ord-12345" }],
        timeWindow: { from: "2026-04-30T10:00:00Z", to: "2026-04-30T11:00:00Z" },
        defaultWindowApplied: false,
        observationDescription: desc,
      },
      markdownContent: `# Investigation Report\n\n**Observation**: ${desc}\n\nThe investigation found no matching events.`,
    };

    expect(report.summary.observationDescription).toBe(desc);
    expect(report.markdownContent).toContain(desc);
  });

  it("report without observationDescription has no observationDescription field in summary", () => {
    const report: Partial<Report> = {
      investigationId: "inv-002",
      summary: {
        serviceId: "order-service",
        environment: "production",
        linkingKeys: [{ type: "http-correlation", value: "trace-abc" }],
        timeWindow: { from: "2026-04-30T10:00:00Z", to: "2026-04-30T11:00:00Z" },
        defaultWindowApplied: true,
      },
      markdownContent: "# Investigation Report\n\nNo observation description provided.",
    };

    expect(report.summary?.observationDescription).toBeUndefined();
  });
});
