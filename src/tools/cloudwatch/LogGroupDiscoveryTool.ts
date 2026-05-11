import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";
import type { LogGroupFilter } from "../service-catalog/ServiceCatalogTool.js";

const DEFAULT_MAX_GROUPS = 50;
const HARD_MAX_GROUPS = 50;

const GRACEFUL_AWS_CODES = new Set([
  "AccessDeniedException",
  "AccessDenied",
  "ResourceNotFoundException",
]);

export interface DiscoveredGroup {
  name: string;
  filter: LogGroupFilter;
}

interface DiscoverySuccess {
  groups: DiscoveredGroup[];
  capped: boolean;
  totalFound: number;
  warning?: string;
}

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    filters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["prefix", "pattern"] },
          value: { type: "string", minLength: 1 },
        },
        required: ["type", "value"],
        additionalProperties: false,
      },
      minItems: 1,
    },
    maxGroups: { type: "number" },
  },
  required: ["filters"],
  additionalProperties: false,
};

interface DiscoveryInput {
  filters: LogGroupFilter[];
  maxGroups?: number;
}

function awsErrorCode(err: unknown): string | undefined {
  const raw = err as Record<string, unknown>;
  return (raw["Code"] ?? raw["name"] ?? raw["__type"]) as string | undefined;
}

export class LogGroupDiscoveryTool implements Tool {
  readonly name = "log-group-discovery";
  readonly description =
    "Resolve log group filter expressions to concrete CloudWatch log group names. Call this after service-catalog to discover all log groups relevant to a service before issuing cloudwatch-logs queries.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: CloudWatchLogsClient;

  constructor(client: CloudWatchLogsClient) {
    this.client = client;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const { filters, maxGroups: requestedMax } = input as DiscoveryInput;
    const cap = Math.min(requestedMax ?? DEFAULT_MAX_GROUPS, HARD_MAX_GROUPS);

    const seen = new Set<string>();
    const groups: DiscoveredGroup[] = [];
    let totalFound = 0;
    let capped = false;

    for (const filter of filters) {
      if (capped) break;
      const result = await this.discoverForFilter(filter, cap, seen, groups);
      if (result.type === "error") {
        return { success: false, data: null, error: result.message };
      }
      if (result.type === "warning") {
        const data: DiscoverySuccess = { groups, capped, totalFound: groups.length, warning: result.message };
        return { success: true, data, error: null };
      }
      totalFound += result.found;
      if (groups.length >= cap) {
        capped = true;
      }
    }

    const data: DiscoverySuccess = { groups, capped, totalFound };
    return { success: true, data, error: null, truncated: capped };
  }

  private buildCommand(filter: LogGroupFilter, nextToken: string | undefined): DescribeLogGroupsCommand {
    return new DescribeLogGroupsCommand(
      filter.type === "prefix"
        ? { logGroupNamePrefix: filter.value, nextToken, limit: 50 }
        : { logGroupNamePattern: filter.value, nextToken, limit: 50 },
    );
  }

  private collectPage(
    logGroups: Array<{ logGroupName?: string | undefined }>,
    filter: LogGroupFilter,
    cap: number,
    seen: Set<string>,
    groups: DiscoveredGroup[],
  ): { found: number; capped: boolean } {
    let found = 0;
    for (const lg of logGroups) {
      if (!lg.logGroupName || seen.has(lg.logGroupName)) continue;
      seen.add(lg.logGroupName);
      groups.push({ name: lg.logGroupName, filter });
      found++;
      if (groups.length >= cap) return { found, capped: true };
    }
    return { found, capped: false };
  }

  private async discoverForFilter(
    filter: LogGroupFilter,
    cap: number,
    seen: Set<string>,
    groups: DiscoveredGroup[],
  ): Promise<{ type: "ok"; found: number } | { type: "warning"; message: string } | { type: "error"; message: string }> {
    let nextToken: string | undefined;
    let found = 0;

    do {
      let response;
      try {
        response = await this.client.send(this.buildCommand(filter, nextToken));
      } catch (err) {
        const code = awsErrorCode(err);
        if (code && GRACEFUL_AWS_CODES.has(code)) {
          return { type: "warning", message: `DescribeLogGroups access denied (${code}) — discovery skipped for filter ${filter.type}:${filter.value}` };
        }
        return { type: "error", message: `DescribeLogGroups failed: ${String(err)}` };
      }

      const page = this.collectPage(response.logGroups ?? [], filter, cap, seen, groups);
      found += page.found;
      if (page.capped) return { type: "ok", found };
      nextToken = response.nextToken;
    } while (nextToken);

    return { type: "ok", found };
  }
}
