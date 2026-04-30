import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import type {
  InvestigationRequest,
  Investigation,
  TraceEntry,
  Hypothesis,
  EvidenceItem,
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
import type { Tool, ToolResult } from "../models/Tool.js";

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_SCAN_BUDGET_BYTES = 1_073_741_824;
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_TIME_WINDOW_MS = 60 * 60 * 1000;

export interface InvestigationAgentConfig {
  tools: Tool[];
  anthropicClient?: Anthropic;
  maxDurationMs?: number | undefined;
}

interface SessionState {
  readonly investigationId: string;
  readonly trace: Trace;
  readonly activeLinkingKeys: LinkingKeySet;
  readonly budget: ScanBudget;
  readonly timer: InvestigationTimer;
  readonly hypotheses: Hypothesis[];
  readonly evidenceBySource: Record<string, EvidenceItem[]>;
  readonly dataSourcesUnavailable: string[];
  readonly uncertaintyFlags: string[];
  resultsTruncated: boolean;
  timedOut: boolean;
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
    const resolvedRequest = this.applyDefaultTimeWindow(request);
    const maxIterations = resolvedRequest.options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const budget = new ScanBudget(resolvedRequest.options?.scanBudgetBytes ?? DEFAULT_SCAN_BUDGET_BYTES);
    const state = this.createSessionState(budget, resolvedRequest.linkingKeys);

    state.trace.appendEntry(this.makeBookendEntry(state.investigationId, "investigation-started"));

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildInvestigationContext(resolvedRequest) },
    ];
    const toolDefinitions = this.registry.getToolDefinitions() as Anthropic.Tool[];
    let iterationCount = 0;

    while (iterationCount < maxIterations && !state.timedOut) {
      if (state.timer.isExpired()) {
        state.timedOut = true;
        state.trace.appendEntry(this.makeTimedOutEntry());
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

      if (response.stop_reason !== "tool_use") break;

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      const toolResults = await this.processToolUseBlocks(toolUseBlocks, state);
      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
      }
    }

    return this.buildInvestigation(resolvedRequest, state);
  }

  private createSessionState(
    budget: ScanBudget,
    initialLinkingKeys: import("../models/LinkingKey.js").LinkingKey[],
  ): SessionState {
    const investigationId = uuidv4();
    const activeLinkingKeys = new LinkingKeySet();
    for (const key of initialLinkingKeys) {
      activeLinkingKeys.add(key);
    }
    return {
      investigationId,
      trace: new Trace(investigationId),
      activeLinkingKeys,
      budget,
      timer: new InvestigationTimer(this.maxDurationMs),
      hypotheses: [],
      evidenceBySource: {},
      dataSourcesUnavailable: [],
      uncertaintyFlags: [],
      resultsTruncated: false,
      timedOut: false,
    };
  }

  private async processToolUseBlocks(
    blocks: Anthropic.ToolUseBlock[],
    state: SessionState,
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of blocks) {
      if (state.timedOut) break;
      results.push(await this.processSingleToolUse(toolUse, state));
    }
    return results;
  }

  private async processSingleToolUse(
    toolUse: Anthropic.ToolUseBlock,
    state: SessionState,
  ): Promise<Anthropic.ToolResultBlockParam> {
    if (state.timer.isExpired()) {
      state.timedOut = true;
      state.trace.appendEntry(this.makeTimedOutEntry());
      return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: "timeout" }), is_error: true };
    }
    const tool = this.registry.lookup(toolUse.name);
    if (!tool) return this.handleToolNotFound(toolUse, state);
    if (toolUse.name !== "produce-report" && state.budget.isExhausted) {
      return this.handleBudgetExhausted(toolUse, state);
    }
    return this.invokeAndRecordTool(tool, toolUse, state);
  }

  private handleToolNotFound(
    toolUse: Anthropic.ToolUseBlock,
    state: SessionState,
  ): Anthropic.ToolResultBlockParam {
    state.trace.appendEntry(this.makeTraceEntry(state.investigationId, {
      type: "tool-unavailable",
      toolName: toolUse.name,
      input: toolUse.input,
      output: null,
      error: `Tool '${toolUse.name}' is not registered`,
      durationMs: 0,
    }));
    state.dataSourcesUnavailable.push(toolUse.name);
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify({ error: `Tool '${toolUse.name}' not found` }),
      is_error: true,
    };
  }

  private handleBudgetExhausted(
    toolUse: Anthropic.ToolUseBlock,
    state: SessionState,
  ): Anthropic.ToolResultBlockParam {
    state.trace.appendEntry(this.makeTraceEntry(state.investigationId, {
      type: "budget-exhausted",
      toolName: toolUse.name,
      input: toolUse.input,
      output: null,
      error: "Scan budget exhausted",
      durationMs: 0,
    }));
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify({ error: "Scan budget exhausted" }),
      is_error: true,
    };
  }

  private async invokeAndRecordTool(
    tool: Tool,
    toolUse: Anthropic.ToolUseBlock,
    state: SessionState,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const callStart = Date.now();
    let result: ToolResult;
    try {
      result = await tool.invoke(toolUse.input);
    } catch (err) {
      state.trace.appendEntry(this.makeTraceEntry(state.investigationId, {
        type: "tool-error",
        toolName: toolUse.name,
        input: toolUse.input,
        output: null,
        error: String(err),
        durationMs: Date.now() - callStart,
      }));
      state.dataSourcesUnavailable.push(toolUse.name);
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify({ error: String(err) }),
        is_error: true,
      };
    }
    const durationMs = Date.now() - callStart;
    this.recordToolResult(toolUse, result, durationMs, state);
    this.postProcessToolResult(toolUse, result, state);
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify(result.data ?? { error: result.error }),
      is_error: !result.success,
    };
  }

  private recordToolResult(
    toolUse: Anthropic.ToolUseBlock,
    result: ToolResult,
    durationMs: number,
    state: SessionState,
  ): void {
    if (result.scanBytesUsed) state.budget.record(result.scanBytesUsed);
    if (result.truncated) {
      state.resultsTruncated = true;
      state.trace.appendEntry(this.makeTraceEntry(state.investigationId, {
        type: "result-truncated",
        toolName: toolUse.name,
        input: toolUse.input,
        output: null,
        error: null,
        durationMs: 0,
      }));
    }
    const entryType = result.success ? "tool-call" : "tool-error";
    state.trace.appendEntry(this.makeTraceEntry(state.investigationId, {
      type: entryType,
      toolName: toolUse.name,
      input: toolUse.input,
      output: result.data,
      error: result.error,
      durationMs,
      scanBytesUsed: result.scanBytesUsed ?? null,
    }));
    if (!result.success) {
      state.dataSourcesUnavailable.push(toolUse.name);
      state.uncertaintyFlags.push(`Tool ${toolUse.name} returned an error: ${result.error ?? ""}`);
    }
  }

  private postProcessToolResult(
    toolUse: Anthropic.ToolUseBlock,
    result: ToolResult,
    state: SessionState,
  ): void {
    if (toolUse.name === "produce-report") {
      const reportData = toolUse.input as Record<string, unknown>;
      state.hypotheses.push(...this.extractHypotheses(reportData));
      const evidence = this.extractEvidence(reportData);
      for (const [source, items] of Object.entries(evidence)) {
        state.evidenceBySource[source] = [...(state.evidenceBySource[source] ?? []), ...items];
      }
    }
    if (toolUse.name === "cloudwatch-logs" && result.success && result.data) {
      this.discoverLinkingKeys(toolUse, result.data, state);
    }
  }

  private discoverLinkingKeys(
    toolUse: Anthropic.ToolUseBlock,
    data: unknown,
    state: SessionState,
  ): void {
    const cwData = data as { entries?: unknown[] };
    const entries = cwData.entries ?? [];
    const input = toolUse.input as Record<string, unknown>;
    const logGroup = input["logGroup"];
    const schema = this.resolveSchemaForLogGroup(typeof logGroup === "string" ? logGroup : "");
    const discoveredKeys = this.extractor.extractFromEntries(entries, schema, "entity");
    for (const key of discoveredKeys) {
      const isNew = state.activeLinkingKeys.add(key);
      if (isNew) {
        state.trace.appendEntry(this.makeTraceEntry(state.investigationId, {
          type: "linking-key-discovered",
          toolName: null,
          input: { discoveredFrom: toolUse.name },
          output: key,
          error: null,
          durationMs: 0,
        }));
      }
    }
  }

  private buildInvestigation(
    resolvedRequest: InvestigationRequest,
    state: SessionState,
  ): Investigation {
    const { investigationId, trace, activeLinkingKeys, hypotheses, evidenceBySource,
      dataSourcesUnavailable, uncertaintyFlags, resultsTruncated, timedOut, budget } = state;

    const status = timedOut
      ? ("timed-out" as const)
      : budget.isExhausted
        ? ("budget-exhausted" as const)
        : ("complete" as const);

    const metadata: ReportMetadata = {
      toolCallsCount: trace.getEntries().filter((e) => e.type === "tool-call").length,
      dataSourcesQueried: [...new Set(
        trace.getEntries()
          .filter((e) => e.type === "tool-call" && e.toolName)
          .map((e) => e.toolName as string),
      )],
      dataSourcesUnavailable: [...new Set(dataSourcesUnavailable)],
      scanBytesUsed: budget.used,
      scanBudgetBytes: budget.budgetBytes,
      resultsTruncated,
      uncertaintyFlags,
    };

    const completeEntryType = status === "timed-out" ? ("timed-out" as const) : ("investigation-complete" as const);
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

  private makeTimedOutEntry(): TraceEntry {
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
      output: unknown;
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
      (h): Hypothesis => {
        const record = h as Record<string, unknown>;
        const desc = record["description"];
        const conf = record["confidence"] as Hypothesis["confidence"] | undefined;
        return {
          id: uuidv4(),
          description: typeof desc === "string" ? desc : "",
          confidence: conf ?? "unknown",
          supportingEvidence: [],
          contradictingEvidence: [],
        };
      },
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
          (item): EvidenceItem => {
            const record = item as Record<string, unknown>;
            return {
              id: uuidv4(),
              source,
              timestamp: typeof record["timestamp"] === "string" ? record["timestamp"] : "",
              description: typeof record["description"] === "string" ? record["description"] : "",
              rawData: item,
              linkingKeys: [],
            };
          },
        );
      }
    }
    return result;
  }
}
