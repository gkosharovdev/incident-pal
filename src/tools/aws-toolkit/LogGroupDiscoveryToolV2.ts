import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";
import type { AwsToolkitClient } from "./AwsToolkitClient.js";
import { AwsToolkitError } from "./AwsToolkitClient.js";
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

interface DiscoveryInput {
  filters: LogGroupFilter[];
  maxGroups?: number;
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

interface AwsLogGroup {
  logGroupName?: string;
  storedBytes?: number;
}

interface DescribeLogGroupsResponse {
  logGroups?: AwsLogGroup[];
  NextToken?: string;
}

function awsErrorCode(err: unknown): string | undefined {
  const raw = err instanceof AwsToolkitError ? err : (err as Record<string, unknown>);
  if (raw instanceof AwsToolkitError) {
    const match = /(\w+Exception|\w+Error|AccessDenied|ResourceNotFoundException)/.exec(
      raw.message,
    );
    return match?.[1];
  }
  return (raw["Code"] ?? raw["name"] ?? raw["__type"]) as string | undefined;
}

type FilterResult =
  | { type: "ok"; found: number }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

export class LogGroupDiscoveryToolV2 implements Tool {
  readonly name = "log-group-discovery";
  readonly description =
    "Resolve log group filter expressions to concrete CloudWatch log group names. Call this after service-catalog to discover all log groups relevant to a service before issuing cloudwatch-logs queries.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: AwsToolkitClient;

  constructor(client: AwsToolkitClient) {
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
        const data: DiscoverySuccess = {
          groups,
          capped,
          totalFound: groups.length,
          warning: result.message,
        };
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

  private handleDiscoveryError(err: unknown, filter: LogGroupFilter): FilterResult {
    const code = awsErrorCode(err);
    if (code && GRACEFUL_AWS_CODES.has(code)) {
      return {
        type: "warning",
        message: `DescribeLogGroups access denied (${code}) — discovery skipped for filter ${filter.type}:${filter.value}`,
      };
    }
    return { type: "error", message: `DescribeLogGroups failed: ${String(err)}` };
  }

  private async discoverForFilter(
    filter: LogGroupFilter,
    cap: number,
    seen: Set<string>,
    groups: DiscoveredGroup[],
  ): Promise<FilterResult> {
    let nextToken: string | undefined;
    let found = 0;

    do {
      const params: Record<string, unknown> =
        filter.type === "prefix"
          ? { LogGroupNamePrefix: filter.value, Limit: 50 }
          : { LogGroupNamePattern: filter.value, Limit: 50 };
      if (nextToken) params["NextToken"] = nextToken;

      let response: DescribeLogGroupsResponse;
      try {
        const result = await this.client.callAws<DescribeLogGroupsResponse>(
          "cloudwatch-logs",
          "DescribeLogGroups",
          params,
        );
        response = result.body;
      } catch (err) {
        return this.handleDiscoveryError(err, filter);
      }

      for (const lg of response.logGroups ?? []) {
        if (!lg.logGroupName || seen.has(lg.logGroupName)) continue;
        seen.add(lg.logGroupName);
        groups.push({ name: lg.logGroupName, filter });
        found++;
        if (groups.length >= cap) return { type: "ok", found };
      }
      nextToken = response.NextToken;
    } while (nextToken);

    return { type: "ok", found };
  }
}
