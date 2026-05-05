import { useState, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction, RefObject } from "react";
import Anthropic from "@anthropic-ai/sdk";
import { InvestigationAgent } from "../../agent/InvestigationAgent.js";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { CloudWatchLogsTool } from "../../tools/cloudwatch/CloudWatchLogsTool.js";
import { EcsDeploymentTool } from "../../tools/ecs/EcsDeploymentTool.js";
import { ServiceCatalogTool } from "../../tools/service-catalog/ServiceCatalogTool.js";
import type { InvestigationRequest, Investigation, TraceEntry } from "../../models/index.js";
import type { CredentialConfig } from "../services/KeychainService.js";

export interface StreamEntry {
  readonly id: string;
  readonly timestamp: Date;
  readonly eventType: TraceEntry["type"];
  readonly label: string;
  readonly summary: string;
  readonly detail: unknown;
}

export type InvestigationStatus = "idle" | "running" | "complete" | "timed-out" | "budget-exhausted" | "error";

interface UseInvestigationResult {
  readonly entries: StreamEntry[];
  readonly status: InvestigationStatus;
  readonly budgetPct: number;
  readonly elapsedMs: number;
  readonly iteration: number;
  readonly investigation: Investigation | null;
  readonly error: string | null;
  readonly start: (request: InvestigationRequest, credentials: CredentialConfig) => void;
}

const MOCK_ENTRIES: Array<{ type: TraceEntry["type"]; label: string; summary: string }> = [
  { type: "investigation-started", label: "Started", summary: "investigating order-service / prod" },
  { type: "tool-call", label: "Tool Call", summary: "cloudwatch-logs: querying /aws/ecs/my-service" },
  { type: "tool-call", label: "Tool Call", summary: "service-catalog: resolving my-service" },
  { type: "linking-key-discovered", label: "Key Found", summary: "entity-id: order:ord-12345" },
  { type: "tool-call", label: "Tool Call", summary: "ecs-deployment: checking deployment history" },
  { type: "tool-error", label: "Tool Error", summary: "cloudwatch-logs: throttled by AWS (retrying)" },
  { type: "tool-call", label: "Tool Call", summary: "cloudwatch-logs: querying with correlationId" },
  { type: "result-truncated", label: "Truncated", summary: "cloudwatch-logs result capped at 500 entries" },
  { type: "hypothesis-formed", label: "Hypothesis", summary: "deployment at 14:32 UTC correlates with error spike" },
  { type: "tool-call", label: "Tool Call", summary: "customer-correlation: looking up order:ord-12345" },
  { type: "investigation-complete", label: "Complete", summary: "investigation finished" },
];

function makeMockEntry(base: typeof MOCK_ENTRIES[0]): StreamEntry {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: new Date(),
    eventType: base.type,
    label: base.label,
    summary: base.summary,
    detail: null,
  };
}

function traceEntryToStream(entry: TraceEntry): StreamEntry {
  const labelMap: Record<TraceEntry["type"], string> = {
    "tool-call": "Tool Call",
    "tool-error": "Tool Error",
    "tool-unavailable": "Unavailable",
    "budget-exhausted": "Budget Exhausted",
    "result-truncated": "Truncated",
    "unparseable-log-entry": "Parse Error",
    "linking-key-discovered": "Key Found",
    "hypothesis-formed": "Hypothesis",
    "investigation-started": "Started",
    "investigation-complete": "Complete",
    "timed-out": "Timed Out",
  };
  return {
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    eventType: entry.type,
    label: labelMap[entry.type],
    summary: entry.toolName
      ? `${entry.toolName}${entry.error ? `: ${entry.error}` : ""}`
      : entry.type,
    detail: entry.output ?? entry.input,
  };
}

export function useInvestigation(): UseInvestigationResult {
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [status, setStatus] = useState<InvestigationStatus>("idle");
  const [budgetPct, setBudgetPct] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [iteration, setIteration] = useState(0);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((request: InvestigationRequest, credentials: CredentialConfig) => {
    setEntries([]);
    setStatus("running");
    setBudgetPct(0);
    setElapsedMs(0);
    setIteration(0);
    setInvestigation(null);
    setError(null);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 500);

    const useMock = process.env["INCIDENT_PAL_MOCK_AGENT"] === "1";

    if (useMock) {
      runMockInvestigation(setEntries, setStatus, setElapsedMs, startTimeRef, timerRef, setIteration);
      return;
    }

    runRealInvestigation(
      request, credentials,
      setEntries, setStatus, setBudgetPct, setIteration, setInvestigation, setError,
      startTimeRef, timerRef,
    );
  }, []);

  return { entries, status, budgetPct, elapsedMs, iteration, investigation, error, start };
}

function runMockInvestigation(
  setEntries: Dispatch<SetStateAction<StreamEntry[]>>,
  setStatus: Dispatch<SetStateAction<InvestigationStatus>>,
  setElapsedMs: Dispatch<SetStateAction<number>>,
  startTimeRef: RefObject<number>,
  timerRef: RefObject<ReturnType<typeof setInterval> | null>,
  setIteration: Dispatch<SetStateAction<number>>,
): void {
  let i = 0;
  const interval = setInterval(() => {
    const base = MOCK_ENTRIES[i % MOCK_ENTRIES.length];
    if (!base) return;
    setEntries((prev) => [...prev, makeMockEntry(base)]);
    setIteration((prev) => prev + 1);
    i++;
    if (i >= MOCK_ENTRIES.length + 3) {
      clearInterval(interval);
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedMs(Date.now() - startTimeRef.current);
      setStatus("complete");
    }
  }, 500);
}

function runRealInvestigation(
  request: InvestigationRequest,
  credentials: CredentialConfig,
  setEntries: Dispatch<SetStateAction<StreamEntry[]>>,
  setStatus: Dispatch<SetStateAction<InvestigationStatus>>,
  setBudgetPct: Dispatch<SetStateAction<number>>,
  setIteration: Dispatch<SetStateAction<number>>,
  setInvestigation: Dispatch<SetStateAction<Investigation | null>>,
  setError: Dispatch<SetStateAction<string | null>>,
  startTimeRef: RefObject<number>,
  timerRef: RefObject<ReturnType<typeof setInterval> | null>,
): void {
  const region = process.env["AWS_REGION"] ?? "us-east-1";
  const cwClient = new CloudWatchLogsClient({ region });
  const ecsClient = new ECSClient({ region });
  const catalogPath = process.env["SERVICE_CATALOG_PATH"] ?? "./service-catalog.yml";

  const agent = new InvestigationAgent({
    tools: [
      new CloudWatchLogsTool(cwClient),
      new EcsDeploymentTool(ecsClient),
      new ServiceCatalogTool(catalogPath),
    ],
    anthropicClient: new Anthropic({ apiKey: credentials.anthropicApiKey }),
    onTraceEntry: (entry): void => {
      setEntries((prev) => [...prev, traceEntryToStream(entry)]);
      if (entry.type === "tool-call") {
        setIteration((prev) => prev + 1);
      }
    },
  });

  agent.investigate(request).then((result) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setInvestigation(result);
    const statusMap: Record<string, InvestigationStatus> = {
      complete: "complete",
      "timed-out": "timed-out",
      "budget-exhausted": "budget-exhausted",
    };
    setStatus(statusMap[result.status] ?? "complete");
  }).catch((err: unknown) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setError(formatAgentError(err));
    setStatus("error");
  });
}

function formatAgentError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return formatAnthropicError(err) ?? formatAwsError(err) ?? (err.message || String(err));
}

// eslint-disable-next-line complexity
function formatAnthropicError(err: Error): string | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "Anthropic API request timed out — the model did not respond in time";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const sysErr = cause instanceof Error ? (cause as NodeJS.ErrnoException) : null;
    // A TypeError here means the header value (API key) is malformed — never echo it
    if (sysErr instanceof TypeError || sysErr?.message.includes("header")) {
      return "ANTHROPIC_API_KEY is malformed — open Settings (Ctrl+S) and re-enter the key (must start with sk-ant-)";
    }
    // Use only the errno code; never include sysErr.message which can contain secrets
    const code = sysErr?.code;
    if (code === "ECONNREFUSED") return "Anthropic API unreachable — connection refused (api.anthropic.com:443)";
    if (code === "ENOTFOUND")    return "Anthropic API unreachable — DNS lookup failed for api.anthropic.com";
    if (code === "ETIMEDOUT")    return "Anthropic API unreachable — connection timed out";
    if (code)                    return `Anthropic API unreachable — ${code}`;
    return "Anthropic API unreachable — check network connectivity";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic API key rejected (401) — check ANTHROPIC_API_KEY";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Anthropic API access denied (403) — check your API key permissions";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic API rate limit exceeded (429) — retry after a moment";
  }
  if (err instanceof Anthropic.InternalServerError) {
    const reqId = (err as { request_id?: string }).request_id;
    return `Anthropic API internal error (500)${reqId ? ` — request_id: ${reqId}` : ""}`;
  }
  if (err instanceof Anthropic.APIError) {
    const status = (err as { status?: number }).status;
    return `Anthropic API error ${status ?? "unknown"}: ${err.message}`;
  }
  return null;
}

function formatAwsError(err: Error): string | null {
  const raw = err as unknown as Record<string, unknown>;
  const code = (raw["Code"] ?? raw["code"]) as string | undefined;
  const meta = raw["$metadata"] as { httpStatusCode?: number } | undefined;
  if (!code && !meta) return null;
  const status = meta?.httpStatusCode ? ` (HTTP ${meta.httpStatusCode})` : "";
  return `AWS error${code ? ` ${code}` : ""}${status}: ${err.message}`;
}
