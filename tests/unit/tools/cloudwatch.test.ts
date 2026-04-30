import { describe, it, expect, vi } from "vitest";
import { CloudWatchLogsTool } from "../../../src/tools/cloudwatch/CloudWatchLogsTool.js";
import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

function makeClient(overrides: Partial<{
  startQuery: () => Promise<{ queryId: string }>;
  getQueryResults: () => Promise<{ status: string; results: unknown[][] }>;
  describeLogGroups: () => Promise<{ logGroups: unknown[] }>;
}>): CloudWatchLogsClient {
  return {
    send: vi.fn().mockImplementation((cmd: { constructor: { name: string } }) => {
      const name = cmd.constructor.name;
      if (name === "StartQueryCommand") {
        return overrides.startQuery?.() ?? Promise.resolve({ queryId: "q-1" });
      }
      if (name === "GetQueryResultsCommand") {
        return overrides.getQueryResults?.() ?? Promise.resolve({ status: "Complete", results: [] });
      }
      if (name === "DescribeLogGroupsCommand") {
        return overrides.describeLogGroups?.() ?? Promise.resolve({ logGroups: [] });
      }
      return Promise.reject(new Error(`Unexpected command: ${name}`));
    }),
  } as unknown as CloudWatchLogsClient;
}

describe("CloudWatchLogsTool", () => {
  it("returns empty entries on no results", async () => {
    const client = makeClient({});
    const tool = new CloudWatchLogsTool(client, 500, 0);

    const result = await tool.invoke({
      logGroup: "/ecs/svc/prod",
      queryExpression: "fields @message",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(true);
    const data = result.data as { entries: unknown[] };
    expect(data.entries).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("parses valid JSON log entries", async () => {
    const client = makeClient({
      getQueryResults: () =>
        Promise.resolve({
          status: "Complete",
          results: [
            [
              { field: "@timestamp", value: "2026-04-30T10:30:00Z" },
              { field: "@message", value: JSON.stringify({ orderId: "ord-1", event: "created" }) },
            ],
          ],
        }),
    });
    const tool = new CloudWatchLogsTool(client, 500, 0);

    const result = await tool.invoke({
      logGroup: "/ecs/order-service/prod",
      queryExpression: "fields @timestamp, @message",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(true);
    const data = result.data as { entries: Array<{ message: unknown; timestamp: string }> };
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]?.timestamp).toBe("2026-04-30T10:30:00Z");
    expect((data.entries[0]?.message as Record<string, string>)?.orderId).toBe("ord-1");
  });

  it("records unparsedCount for non-JSON log entries without failing", async () => {
    const client = makeClient({
      getQueryResults: () =>
        Promise.resolve({
          status: "Complete",
          results: [
            [
              { field: "@timestamp", value: "2026-04-30T10:30:00Z" },
              { field: "@message", value: "plain text log line - not JSON" },
            ],
          ],
        }),
    });
    const tool = new CloudWatchLogsTool(client, 500, 0);

    const result = await tool.invoke({
      logGroup: "/ecs/svc/prod",
      queryExpression: "fields @message",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(true);
    const data = result.data as { entries: unknown[]; unparsedCount: number };
    expect(data.entries).toHaveLength(1);
    expect(data.unparsedCount).toBe(1);
  });

  it("returns error when StartQuery fails", async () => {
    const client = makeClient({
      startQuery: () => Promise.reject(new Error("ThrottlingException")),
    });
    const tool = new CloudWatchLogsTool(client, 500, 0);

    const result = await tool.invoke({
      logGroup: "/ecs/svc/prod",
      queryExpression: "fields @message",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("StartQuery failed");
  });

  it("truncates results when limit hit and sets truncated flag", async () => {
    const singleResult = [
      { field: "@timestamp", value: "2026-04-30T10:30:00Z" },
      { field: "@message", value: "{}" },
    ];
    const results = Array.from({ length: 2 }, () => singleResult);
    const client = makeClient({
      getQueryResults: () => Promise.resolve({ status: "Complete", results }),
    });
    const tool = new CloudWatchLogsTool(client, 2, 0);

    const result = await tool.invoke({
      logGroup: "/ecs/svc/prod",
      queryExpression: "fields @message",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("returns error when query ends in non-Complete status", async () => {
    const client = makeClient({
      getQueryResults: () => Promise.resolve({ status: "Failed", results: [] }),
    });
    const tool = new CloudWatchLogsTool(client, 500, 0);

    const result = await tool.invoke({
      logGroup: "/ecs/svc/prod",
      queryExpression: "fields @message",
      from: "2026-04-30T10:00:00Z",
      to: "2026-04-30T11:00:00Z",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed");
  });
});
