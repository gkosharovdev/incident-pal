import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";
import type { AwsToolkitClient } from "./AwsToolkitClient.js";
import { AwsToolkitError } from "./AwsToolkitClient.js";

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

interface DescribeLogGroupsResponse {
  logGroups?: Array<{ logGroupName?: string; storedBytes?: number }>;
}

interface StartQueryResponse {
  QueryId?: string;
}

interface GetQueryResultsResponse {
  Status?: string;
  Results?: Array<Array<{ Field?: string; Value?: string }>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseResultRows(
  rawResults: Array<Array<{ Field?: string; Value?: string }>>,
): { entries: LogEntry[]; unparsedCount: number } {
  const entries: LogEntry[] = [];
  let unparsedCount = 0;
  for (const row of rawResults) {
    const fields: Record<string, string> = {};
    let timestamp = "";
    let rawMessage = "";
    for (const field of row) {
      if (field.Field && field.Value !== undefined) {
        fields[field.Field] = field.Value;
        if (field.Field === "@timestamp") timestamp = field.Value;
        if (field.Field === "@message") rawMessage = field.Value;
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

export class CloudWatchLogsToolV2 implements Tool {
  readonly name = "cloudwatch-logs";
  readonly description =
    "Query CloudWatch Logs Insights for structured log entries matching specific criteria. Returns parsed JSON log entries with timestamps. Use to find evidence of service activity, errors, and entity-related events.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: AwsToolkitClient;
  private readonly maxResultsPerQuery: number;
  private readonly pollIntervalMs: number;

  constructor(
    client: AwsToolkitClient,
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

    const scannedBytesEstimate = await this.estimateLogGroupBytes(params.logGroup);

    let queryId: string;
    try {
      const startResult = await this.client.callAws<StartQueryResponse>(
        "cloudwatch-logs",
        "StartQuery",
        {
          LogGroupName: params.logGroup,
          QueryString: params.queryExpression,
          StartTime: fromEpoch,
          EndTime: toEpoch,
          Limit: limit,
        },
      );
      if (!startResult.body.QueryId) {
        return { success: false, data: null, error: "CloudWatch did not return a QueryId" };
      }
      queryId = startResult.body.QueryId;
    } catch (err) {
      return {
        success: false,
        data: null,
        error: `StartQuery failed: ${err instanceof AwsToolkitError ? err.message : String(err)}`,
      };
    }

    return this.pollQuery(queryId, limit, scannedBytesEstimate);
  }

  private async estimateLogGroupBytes(logGroup: string): Promise<number> {
    try {
      const result = await this.client.callAws<DescribeLogGroupsResponse>(
        "cloudwatch-logs",
        "DescribeLogGroups",
        { LogGroupNamePrefix: logGroup },
      );
      const group = result.body.logGroups?.find((g) => g.logGroupName === logGroup);
      return group?.storedBytes ?? 0;
    } catch {
      return 0;
    }
  }

  private async pollQuery(
    queryId: string,
    limit: number,
    scannedBytesEstimate: number,
  ): Promise<ToolResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(this.pollIntervalMs);
      try {
        const pollResult = await this.client.callAws<GetQueryResultsResponse>(
          "cloudwatch-logs",
          "GetQueryResults",
          { QueryId: queryId },
        );
        const status = pollResult.body.Status;
        if (status === "Running" || status === "Scheduled") continue;
        if (status !== "Complete") {
          return {
            success: false,
            data: null,
            error: `CloudWatch query ended with status: ${status ?? "unknown"}`,
          };
        }
        const rawResults = pollResult.body.Results ?? [];
        const { entries, unparsedCount } = parseResultRows(rawResults);
        const truncated = rawResults.length >= limit;
        const result: CloudWatchResult = {
          entries,
          truncated,
          scannedBytesEstimate,
          unparsedCount,
        };
        return {
          success: true,
          data: result,
          error: null,
          scanBytesUsed: scannedBytesEstimate,
          truncated,
        };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: `GetQueryResults failed: ${err instanceof AwsToolkitError ? err.message : String(err)}`,
        };
      }
    }
    return {
      success: false,
      data: null,
      error: "CloudWatch query timed out after polling limit exceeded",
    };
  }
}
