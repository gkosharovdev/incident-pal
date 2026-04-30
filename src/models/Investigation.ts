import type { LinkingKey, LinkingKeySet } from "./LinkingKey.js";
import type { Trace } from "./Trace.js";

export type Environment = "production" | "staging" | "canary";
export type Confidence = "high" | "medium" | "low" | "unknown";
export type InvestigationStatus =
  | "running"
  | "complete"
  | "failed"
  | "budget-exhausted"
  | "timed-out";

export type TraceEntryType =
  | "tool-call"
  | "tool-error"
  | "tool-unavailable"
  | "budget-exhausted"
  | "result-truncated"
  | "unparseable-log-entry"
  | "linking-key-discovered"
  | "hypothesis-formed"
  | "investigation-started"
  | "investigation-complete"
  | "timed-out";

export interface TimeWindow {
  from: string;
  to: string;
}

export interface InvestigationRequest {
  serviceId: string;
  environment: Environment;
  linkingKeys: LinkingKey[];
  timeWindow?: TimeWindow;
  observationDescription?: string;
  options?: {
    maxIterations?: number;
    scanBudgetBytes?: number;
    maxResultsPerQuery?: number;
  };
}

export interface TraceEntry {
  id: string;
  timestamp: string;
  type: TraceEntryType;
  toolName: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number;
  scanBytesUsed: number | null;
}

export interface EvidenceItem {
  id: string;
  source: string;
  timestamp: string;
  description: string;
  rawData: unknown;
  linkingKeys: LinkingKey[];
}

export interface Hypothesis {
  id: string;
  description: string;
  confidence: Confidence;
  supportingEvidence: EvidenceItem[];
  contradictingEvidence: EvidenceItem[];
}

export interface TimelineEvent {
  timestamp: string;
  source: string;
  description: string;
}

export interface ReportSummary {
  serviceId: string;
  environment: string;
  linkingKeys: LinkingKey[];
  timeWindow: TimeWindow;
  defaultWindowApplied: boolean;
  observationDescription?: string;
}

export interface ReportMetadata {
  toolCallsCount: number;
  dataSourcesQueried: string[];
  dataSourcesUnavailable: string[];
  scanBytesUsed: number;
  scanBudgetBytes: number;
  resultsTruncated: boolean;
  uncertaintyFlags: string[];
}

export interface Report {
  investigationId: string;
  summary: ReportSummary;
  timeline: TimelineEvent[];
  evidenceBySource: Record<string, EvidenceItem[]>;
  hypotheses: Hypothesis[];
  likelyFailurePoint: Hypothesis | null;
  recommendedActions: string[];
  metadata: ReportMetadata;
  markdownContent: string;
}

export interface Investigation {
  id: string;
  request: InvestigationRequest;
  status: InvestigationStatus;
  activeLinkingKeys: LinkingKeySet;
  trace: Trace;
  hypotheses: Hypothesis[];
  report: Report | null;
  startedAt: string;
  completedAt: string | null;
}
