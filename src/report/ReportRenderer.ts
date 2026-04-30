import type {
  Investigation,
  Report,
  EvidenceItem,
  ReportMetadata,
  Hypothesis,
} from "../models/Investigation.js";
import type { LinkingKey } from "../models/LinkingKey.js";

const CONFIDENCE_EMOJI: Record<string, string> = {
  high: "🟢",
  medium: "🟡",
  low: "🔴",
  unknown: "⚪",
};

export class ReportRenderer {
  render(
    investigation: Investigation,
    evidenceBySource: Record<string, EvidenceItem[]>,
    metadata: ReportMetadata,
  ): Report {
    const { request, status, hypotheses, id } = investigation;
    const likelyFailurePoint = this.selectLikelyFailurePoint(hypotheses);

    const markdownContent = this.renderMarkdown({
      investigation,
      evidenceBySource,
      metadata,
      likelyFailurePoint,
      status,
    });

    return {
      investigationId: id,
      summary: {
        serviceId: request.serviceId,
        environment: request.environment,
        linkingKeys: request.linkingKeys,
        timeWindow: request.timeWindow ?? {
          from: new Date(Date.now() - 3_600_000).toISOString(),
          to: new Date().toISOString(),
        },
        defaultWindowApplied: !request.timeWindow,
        ...(request.observationDescription !== undefined
          ? { observationDescription: request.observationDescription }
          : {}),
      },
      timeline: [],
      evidenceBySource,
      hypotheses,
      likelyFailurePoint,
      recommendedActions: this.extractRecommendedActions(hypotheses, metadata),
      metadata,
      markdownContent,
    };
  }

  private selectLikelyFailurePoint(hypotheses: Hypothesis[]): Hypothesis | null {
    if (hypotheses.length === 0) return null;
    const ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
    const sorted = [...hypotheses].sort(
      (a, b) => (ORDER[b.confidence] ?? 0) - (ORDER[a.confidence] ?? 0),
    );
    const top = sorted[0];
    if (!top || top.confidence === "unknown") return null;
    return top;
  }

  private extractRecommendedActions(
    hypotheses: Hypothesis[],
    metadata: ReportMetadata,
  ): string[] {
    const actions: string[] = [];
    if (metadata.dataSourcesUnavailable.length > 0) {
      actions.push(
        `Investigate why these data sources were unavailable: ${metadata.dataSourcesUnavailable.join(", ")}`,
      );
    }
    if (metadata.resultsTruncated) {
      actions.push("Results were truncated — consider narrowing the time window for a follow-up query");
    }
    if (hypotheses.length === 0 || hypotheses.every((h) => h.confidence === "unknown")) {
      actions.push("No conclusive evidence found — widen the time window or check additional data sources");
    }
    return actions;
  }

  private renderMarkdown(opts: {
    investigation: Investigation;
    evidenceBySource: Record<string, EvidenceItem[]>;
    metadata: ReportMetadata;
    likelyFailurePoint: Hypothesis | null;
    status: string;
  }): string {
    const { investigation, evidenceBySource, metadata, likelyFailurePoint, status } = opts;
    const { request } = investigation;
    return [
      ...this.renderTimeoutWarning(status),
      "# Investigation Report", "",
      "## Summary", "",
      ...this.renderSummaryLines(request),
      "",
      ...this.renderEvidenceLines(evidenceBySource, metadata),
      ...this.renderHypothesesLines(investigation.hypotheses, metadata),
      ...this.renderFailurePointLines(likelyFailurePoint),
      ...this.renderActionsLines(investigation.hypotheses, metadata),
      ...this.renderMetadataLines(metadata),
    ].join("\n");
  }

  private renderTimeoutWarning(status: string): string[] {
    if (status !== "timed-out") return [];
    return [
      "## ⚠️ Investigation Timed Out",
      "",
      "The investigation reached the configured wall-clock limit. The findings below are partial.",
      "",
    ];
  }

  private renderSummaryLines(
    request: Investigation["request"],
  ): string[] {
    const lines: string[] = [
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Service** | \`${request.serviceId}\` |`,
      `| **Environment** | ${request.environment} |`,
      `| **Linking Keys** | ${request.linkingKeys.map((k) => this.formatLinkingKey(k)).join(", ")} |`,
      `| **Time Window** | ${request.timeWindow?.from ?? "N/A"} → ${request.timeWindow?.to ?? "N/A"} |`,
    ];
    if (!request.timeWindow) {
      lines.push(`| **Default Window Applied** | Yes — past 60 minutes |`);
    }
    if (request.observationDescription) {
      lines.push(`| **Observation** | ${request.observationDescription} |`);
    }
    return lines;
  }

  private renderEvidenceLines(
    evidenceBySource: Record<string, EvidenceItem[]>,
    metadata: ReportMetadata,
  ): string[] {
    const lines: string[] = ["## Evidence", ""];
    const totalEvidence = Object.values(evidenceBySource).flat();
    if (totalEvidence.length === 0) {
      lines.push("No evidence found matching the provided linking keys in any data source.");
      if (metadata.dataSourcesUnavailable.length > 0) {
        lines.push(
          `\n> ⚠️ The following data sources were unavailable: ${metadata.dataSourcesUnavailable.join(", ")}`,
        );
      }
    } else {
      for (const [source, items] of Object.entries(evidenceBySource)) {
        if (items.length === 0) continue;
        lines.push(`### ${source}`, "");
        for (const item of items) {
          lines.push(`- **${item.timestamp}**: ${item.description}`);
        }
        lines.push("");
      }
    }
    return lines;
  }

  private renderHypothesesLines(hypotheses: Hypothesis[], metadata: ReportMetadata): string[] {
    const lines: string[] = ["## Hypotheses", ""];
    if (hypotheses.length === 0) {
      lines.push("No hypotheses formed — insufficient evidence to identify a likely failure point.");
      metadata.uncertaintyFlags.push("No hypotheses formed");
    } else {
      for (const h of hypotheses) {
        const emoji = CONFIDENCE_EMOJI[h.confidence] ?? "⚪";
        lines.push(`### ${emoji} ${h.description}`, "", `**Confidence**: ${h.confidence}`, "");
      }
    }
    return lines;
  }

  private renderFailurePointLines(likelyFailurePoint: Hypothesis | null): string[] {
    const lines: string[] = ["## Likely Failure Point", ""];
    if (likelyFailurePoint) {
      const emoji = CONFIDENCE_EMOJI[likelyFailurePoint.confidence] ?? "⚪";
      lines.push(
        `${emoji} **${likelyFailurePoint.description}**`,
        `*(Confidence: ${likelyFailurePoint.confidence})*`,
      );
    } else {
      lines.push("Inconclusive — insufficient evidence to identify a single failure point.");
    }
    return lines;
  }

  private renderActionsLines(hypotheses: Hypothesis[], metadata: ReportMetadata): string[] {
    const lines: string[] = ["", "## Recommended Next Actions", ""];
    const actions = this.extractRecommendedActions(hypotheses, metadata);
    if (actions.length === 0) {
      lines.push("No specific actions recommended based on available evidence.");
    } else {
      for (const action of actions) {
        lines.push(`1. ${action}`);
      }
    }
    return lines;
  }

  private renderMetadataLines(metadata: ReportMetadata): string[] {
    const lines: string[] = [
      "",
      "## Investigation Metadata",
      "",
      `- **Tool calls made**: ${metadata.toolCallsCount}`,
      `- **Data sources queried**: ${metadata.dataSourcesQueried.join(", ") || "none"}`,
    ];
    if (metadata.dataSourcesUnavailable.length > 0) {
      lines.push(`- **Data sources unavailable**: ${metadata.dataSourcesUnavailable.join(", ")}`);
    }
    lines.push(
      `- **Scan budget used**: ${this.formatBytes(metadata.scanBytesUsed)} / ${this.formatBytes(metadata.scanBudgetBytes)}`,
    );
    if (metadata.resultsTruncated) {
      lines.push("- ⚠️ Some query results were truncated — results may be incomplete");
    }
    if (metadata.uncertaintyFlags.length > 0) {
      lines.push("- **Uncertainty flags**:");
      for (const flag of metadata.uncertaintyFlags) {
        lines.push(`  - ${flag}`);
      }
    }
    return lines;
  }

  private formatLinkingKey(key: LinkingKey): string {
    if (key.type === "entity-id") return `\`${key.entityType}:${key.value}\``;
    if (key.type === "http-correlation") return `HTTP \`${key.value}\``;
    return `Kafka \`${key.value}\``;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exp);
    return `${value.toFixed(1)} ${units[exp] ?? "B"}`;
  }
}
