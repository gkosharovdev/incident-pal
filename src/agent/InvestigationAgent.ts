import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import type {
  InvestigationRequest,
  Investigation,
  TraceEntry,
  Hypothesis,
  EvidenceItem,
  Report,
  ReportMetadata,
} from "../models/Investigation.js";
import { LinkingKeySet } from "../models/LinkingKey.js";
import { Trace } from "../models/Trace.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { ScanBudget } from "./ScanBudget.js";
import { InvestigationTimer } from "./InvestigationTimer.js";
import { SYSTEM_PROMPT, buildInvestigationContext } from "./prompts.js";
import { ReportRenderer } from "../report/ReportRenderer.js";
import { LinkingKeyExtractor } from "./LinkingKeyExtractor.js";
import type { LinkingKeySchema } from "./LinkingKeyExtractor.js";

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_SCAN_BUDGET_BYTES = 1_073_741_824;
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_TIME_WINDOW_MS = 60 * 60 * 1000;

export interface InvestigationAgentConfig {
  tools: import("../models/Tool.js").Tool[];
  anthropicClient?: Anthropic;
  maxDurationMs?: number | undefined;
}

export class InvestigationAgent {
  private readonly registry: ToolRegistry;
  private readonly anthropic: Anthropic;
  private readonly maxDurationMs: number;
  private readonly renderer: ReportRenderer;
  private readonly extractor: LinkingKeyExtractor;

  constructor(config: InvestigationAgentConfig) {
    this.registry = new ToolRegistry();
    for (const tool of config.tools) {
      this.registry.register(tool);
    }
    this.anthropic = config.anthropicClient ?? new Anthropic();
    this.maxDurationMs = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.renderer = new ReportRenderer();
    this.extractor = new LinkingKeyExtractor();
  }

  async investigate(request: InvestigationRequest): Promise<Investigation> {
    const investigationId = uuidv4();
    const trace = new Trace(investigationId);
    const activeLinkingKeys = new LinkingKeySet();

    for (const key of request.linkingKeys) {
      activeLinkingKeys.add(key);
    }

    const resolvedRequest = this.applyDefaultTimeWindow(request);
    const maxIterations = resolvedRequest.options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const scanBudgetBytes = resolvedRequest.options?.scanBudgetBytes ?? DEFAULT_SCAN_BUDGET_BYTES;
    const budget = new ScanBudget(scanBudgetBytes);
    const timer = new InvestigationTimer(this.maxDurationMs);
    const hypotheses: Hypothesis[] = [];
    const evidenceBySource: Record<string, EvidenceItem[]> = {};
    const dataSourcesUnavailable: string[] = [];
    const uncertaintyFlags: string[] = [];
    let resultsTruncated = false;

    trace.appendEntry(this.makeBookendEntry(investigationId, "investigation-started"));

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildInvestigationContext(resolvedRequest) },
    ];

    const toolDefinitions = this.registry.getToolDefinitions() as Anthropic.Tool[];
    let iterationCount = 0;
    let timedOut = false;

    while (iterationCount < maxIterations) {
      if (timer.isExpired()) {
        timedOut = true;
        trace.appendEntry(this.makeTimedOutEntry(investigationId));
        break;
      }

      iterationCount++;

      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: toolDefinitions,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        break;
      }

      if (response.stop_reason !== "tool_use") {
        break;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (timer.isExpired()) {
          timedOut = true;
          trace.appendEntry(this.makeTimedOutEntry(investigationId));
          break;
        }

        const tool = this.registry.lookup(toolUse.name);
        const callStart = Date.now();

        if (!tool) {
          const entry = this.makeTraceEntry(investigationId, {
            type: "tool-unavailable",
            toolName: toolUse.name,
            input: toolUse.input,
            output: null,
            error: `Tool '${toolUse.name}' is not registered`,
            durationMs: 0,
          });
          trace.appendEntry(entry);
          dataSourcesUnavailable.push(toolUse.name);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: `Tool '${toolUse.name}' not found` }),
            is_error: true,
          });
          continue;
        }

        if (toolUse.name !== "produce-report") {
          const inputWithBudget = toolUse.input as Record<string, unknown>;
          const estimated = budget.remaining;
          if (!budget.canAfford(estimated > 0 ? 1 : 0) && budget.isExhausted) {
            const entry = this.makeTraceEntry(investigationId, {
              type: "budget-exhausted",
              toolName: toolUse.name,
              input: toolUse.input,
              output: null,
              error: "Scan budget exhausted",
              durationMs: 0,
            });
            trace.appendEntry(entry);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: "Scan budget exhausted" }),
              is_error: true,
            });
            continue;
          }
          void inputWithBudget;
        }

        let result;
        try {
          result = await tool.invoke(toolUse.input);
        } catch (err) {
          const entry = this.makeTraceEntry(investigationId, {
            type: "tool-error",
            toolName: toolUse.name,
            input: toolUse.input,
            output: null,
            error: String(err),
            durationMs: Date.now() - callStart,
          });
          trace.appendEntry(entry);
          dataSourcesUnavailable.push(toolUse.name);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: String(err) }),
            is_error: true,
          });
          continue;
        }

        const durationMs = Date.now() - callStart;

        if (result.scanBytesUsed) {
          budget.record(result.scanBytesUsed);
        }
        if (result.truncated) {
          resultsTruncated = true;
          const entry = this.makeTraceEntry(investigationId, {
            type: "result-truncated",
            toolName: toolUse.name,
            input: toolUse.input,
            output: null,
            error: null,
            durationMs: 0,
          });
          trace.appendEntry(entry);
        }

        const entryType = result.success ? "tool-call" : "tool-error";
        const entry = this.makeTraceEntry(investigationId, {
          type: entryType,
          toolName: toolUse.name,
          input: toolUse.input,
          output: result.data,
          error: result.error,
          durationMs,
          scanBytesUsed: result.scanBytesUsed ?? null,
        });
        trace.appendEntry(entry);

        if (!result.success) {
          dataSourcesUnavailable.push(toolUse.name);
          uncertaintyFlags.push(`Tool ${toolUse.name} returned an error: ${result.error ?? ""}`);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result.data ?? { error: result.error }),
          is_error: !result.success,
        });

        if (toolUse.name === "produce-report") {
          const reportData = toolUse.input as Record<string, unknown>;
          hypotheses.push(...this.extractHypotheses(reportData));
          const evidence = this.extractEvidence(reportData);
          for (const [source, items] of Object.entries(evidence)) {
            evidenceBySource[source] = [...(evidenceBySource[source] ?? []), ...items];
          }
        }

        if (toolUse.name === "cloudwatch-logs" && result.success && result.data) {
          const cwData = result.data as { entries?: unknown[] };
          const entries = cwData.entries ?? [];
          const input = toolUse.input as Record<string, unknown>;
          const schema = this.resolveSchemaForLogGroup(String(input["logGroup"] ?? ""));
          const discoveredKeys = this.extractor.extractFromEntries(entries, schema, "entity");
          for (const key of discoveredKeys) {
            const isNew = activeLinkingKeys.add(key);
            if (isNew) {
              trace.appendEntry(
                this.makeTraceEntry(investigationId, {
                  type: "linking-key-discovered",
                  toolName: null,
                  input: { discoveredFrom: toolUse.name },
                  output: key,
                  error: null,
                  durationMs: 0,
                }),
              );
            }
          }
        }
      }

      if (timedOut) break;

      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
      }
    }

    const status = timedOut
      ? ("timed-out" as const)
      : budget.isExhausted
        ? ("budget-exhausted" as const)
        : ("complete" as const);

    const metadata: ReportMetadata = {
      toolCallsCount: trace
        .getEntries()
        .filter((e) => e.type === "tool-call").length,
      dataSourcesQueried: [
        ...new Set(
          trace
            .getEntries()
            .filter((e) => e.type === "tool-call" && e.toolName)
            .map((e) => e.toolName as string),
        ),
      ],
      dataSourcesUnavailable: [...new Set(dataSourcesUnavailable)],
      scanBytesUsed: budget.used,
      scanBudgetBytes: budget.budgetBytes,
      resultsTruncated,
      uncertaintyFlags,
    };

    const completeEntryType =
      status === "timed-out" ? ("timed-out" as const) : ("investigation-complete" as const);
    trace.appendEntry(this.makeBookendEntry(investigationId, completeEntryType));

    const investigation: Investigation = {
      id: investigationId,
      request: resolvedRequest,
      status,
      activeLinkingKeys,
      trace,
      hypotheses,
      report: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const report = this.renderer.render(investigation, evidenceBySource, metadata);
    investigation.report = report;

    return investigation;
  }

  private applyDefaultTimeWindow(request: InvestigationRequest): InvestigationRequest {
    if (request.timeWindow) return request;
    const now = Date.now();
    return {
      ...request,
      timeWindow: {
        from: new Date(now - DEFAULT_TIME_WINDOW_MS).toISOString(),
        to: new Date(now).toISOString(),
      },
    };
  }

  private makeBookendEntry(
    investigationId: string,
    type: "investigation-started" | "investigation-complete" | "timed-out",
  ): TraceEntry {
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type,
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: 0,
      scanBytesUsed: null,
    };
  }

  private makeTimedOutEntry(investigationId: string): TraceEntry {
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type: "timed-out",
      toolName: null,
      input: null,
      output: null,
      error: null,
      durationMs: this.maxDurationMs,
      scanBytesUsed: null,
    };
  }

  private makeTraceEntry(
    _investigationId: string,
    fields: {
      type: TraceEntry["type"];
      toolName: string | null;
      input: unknown;
      output: unknown | null;
      error: string | null;
      durationMs: number;
      scanBytesUsed?: number | null;
    },
  ): TraceEntry {
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type: fields.type,
      toolName: fields.toolName,
      input: fields.input,
      output: fields.output,
      error: fields.error,
      durationMs: fields.durationMs,
      scanBytesUsed: fields.scanBytesUsed ?? null,
    };
  }

  private extractHypotheses(reportData: Record<string, unknown>): Hypothesis[] {
    const raw = reportData["hypotheses"];
    if (!Array.isArray(raw)) return [];
    return raw.map(
      (h): Hypothesis => ({
        id: uuidv4(),
        description: String((h as Record<string, unknown>)["description"] ?? ""),
        confidence: (h as Record<string, unknown>)["confidence"] as Hypothesis["confidence"] ??
          "unknown",
        supportingEvidence: [],
        contradictingEvidence: [],
      }),
    );
  }

  private resolveSchemaForLogGroup(_logGroup: string): LinkingKeySchema {
    return {
      orderId: "entity-id",
      customerId: "entity-id",
      paymentId: "entity-id",
      traceId: "http-correlation",
      correlationId: "http-correlation",
      messageId: "kafka-message-id",
      kafkaMessageId: "kafka-message-id",
    };
  }

  private extractEvidence(reportData: Record<string, unknown>): Record<string, EvidenceItem[]> {
    const raw = reportData["evidenceBySource"];
    if (!raw || typeof raw !== "object") return {};
    const result: Record<string, EvidenceItem[]> = {};
    for (const [source, items] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(items)) {
        result[source] = items.map(
          (item): EvidenceItem => ({
            id: uuidv4(),
            source,
            timestamp: String((item as Record<string, unknown>)["timestamp"] ?? ""),
            description: String((item as Record<string, unknown>)["description"] ?? ""),
            rawData: item,
            linkingKeys: [],
          }),
        );
      }
    }
    return result;
  }
}
