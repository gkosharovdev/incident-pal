import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  DescribeLogGroupsCommand,
  type ResultField,
} from "@aws-sdk/client-cloudwatch-logs";
import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";

const DEFAULT_MAX_RESULTS = 500;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 60;

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    logGroup: { type: "string", description: "CloudWatch log group name" },
    queryExpression: {
      type: "string",
      description: "CloudWatch Logs Insights query expression",
    },
    from: { type: "string", description: "ISO 8601 start time" },
    to: { type: "string", description: "ISO 8601 end time" },
    maxResults: {
      type: "number",
      description: "Maximum number of results to return (default: 500)",
    },
  },
  required: ["logGroup", "queryExpression", "from", "to"],
  additionalProperties: false,
};

interface CloudWatchInput {
  logGroup: string;
  queryExpression: string;
  from: string;
  to: string;
  maxResults?: number;
}

interface LogEntry {
  timestamp: string;
  message: unknown;
  fields: Record<string, string>;
  raw: string;
}

interface CloudWatchResult {
  entries: LogEntry[];
  truncated: boolean;
  scannedBytesEstimate: number;
  unparsedCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function estimateLogGroupBytes(
  client: CloudWatchLogsClient,
  logGroup: string,
): Promise<number> {
  try {
    const response = await client.send(
      new DescribeLogGroupsCommand({ logGroupNamePrefix: logGroup }),
    );
    const group = response.logGroups?.find((g) => g.logGroupName === logGroup);
    return group?.storedBytes ?? 0;
  } catch {
    return 0;
  }
}

export class CloudWatchLogsTool implements Tool {
  readonly name = "cloudwatch-logs";
  readonly description =
    "Query CloudWatch Logs Insights for structured log entries matching specific criteria. Returns parsed JSON log entries with timestamps. Use to find evidence of service activity, errors, and entity-related events.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: CloudWatchLogsClient;
  private readonly maxResultsPerQuery: number;
  private readonly pollIntervalMs: number;

  constructor(
    client: CloudWatchLogsClient,
    maxResultsPerQuery = DEFAULT_MAX_RESULTS,
    pollIntervalMs = POLL_INTERVAL_MS,
  ) {
    this.client = client;
    this.maxResultsPerQuery = maxResultsPerQuery;
    this.pollIntervalMs = pollIntervalMs;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const params = input as CloudWatchInput;
    const limit = Math.min(params.maxResults ?? this.maxResultsPerQuery, this.maxResultsPerQuery);

    const fromEpoch = Math.floor(new Date(params.from).getTime() / 1000);
    const toEpoch = Math.floor(new Date(params.to).getTime() / 1000);

    const scannedBytesEstimate = await estimateLogGroupBytes(this.client, params.logGroup);

    let queryId: string;
    try {
      const startResponse = await this.client.send(
        new StartQueryCommand({
          logGroupName: params.logGroup,
          queryString: params.queryExpression,
          startTime: fromEpoch,
          endTime: toEpoch,
          limit,
        }),
      );
      if (!startResponse.queryId) {
        return { success: false, data: null, error: "CloudWatch did not return a queryId" };
      }
      queryId = startResponse.queryId;
    } catch (err) {
      return {
        success: false,
        data: null,
        error: `StartQuery failed: ${String(err)}`,
      };
    }

    return this.pollQuery(queryId, limit, scannedBytesEstimate);
  }

  private async pollQuery(
    queryId: string,
    limit: number,
    scannedBytesEstimate: number,
  ): Promise<ToolResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(this.pollIntervalMs);
      try {
        const pollResponse = await this.client.send(new GetQueryResultsCommand({ queryId }));
        const status = pollResponse.status;
        if (status === "Running" || status === "Scheduled") continue;
        if (status !== "Complete") {
          return { success: false, data: null, error: `CloudWatch query ended with status: ${status ?? "unknown"}` };
        }
        const rawResults = pollResponse.results ?? [];
        const { entries, unparsedCount } = this.parseResultRows(rawResults);
        const truncated = rawResults.length >= limit;
        const result: CloudWatchResult = { entries, truncated, scannedBytesEstimate, unparsedCount };
        return { success: true, data: result, error: null, scanBytesUsed: scannedBytesEstimate, truncated };
      } catch (err) {
        return { success: false, data: null, error: `GetQueryResults failed: ${String(err)}` };
      }
    }
    return { success: false, data: null, error: "CloudWatch query timed out after polling limit exceeded" };
  }

  private parseResultRows(
    rawResults: ResultField[][],
  ): { entries: LogEntry[]; unparsedCount: number } {
    const entries: LogEntry[] = [];
    let unparsedCount = 0;
    for (const row of rawResults) {
      const fields: Record<string, string> = {};
      let timestamp = "";
      let rawMessage = "";
      for (const field of row) {
        if (field.field && field.value !== undefined) {
          fields[field.field] = field.value;
          if (field.field === "@timestamp") timestamp = field.value;
          if (field.field === "@message") rawMessage = field.value;
        }
      }
      let message: unknown = rawMessage;
      try {
        message = JSON.parse(rawMessage) as unknown;
      } catch {
        unparsedCount++;
      }
      entries.push({ timestamp, message, fields, raw: rawMessage });
    }
    return { entries, unparsedCount };
  }
}
