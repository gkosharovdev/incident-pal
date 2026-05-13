import { describe, it, expect, vi } from "vitest";
import { CloudWatchLogsToolV2 } from "../../../src/tools/aws-toolkit/CloudWatchLogsToolV2.js";
import type { AwsToolkitClient } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";
import { AwsToolkitError } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";

function makeClient(
  callAws: (service: string, operation: string, params: Record<string, unknown>) => Promise<{ body: unknown }>,
): AwsToolkitClient {
  return { callAws: vi.fn().mockImplementation(callAws) } as unknown as AwsToolkitClient;
}

const BASE_INPUT = {
  logGroup: "/ecs/svc/prod",
  queryExpression: "fields @message",
  from: "2026-05-01T10:00:00Z",
  to: "2026-05-01T11:00:00Z",
};

describe("CloudWatchLogsToolV2", () => {
  it("calls DescribeLogGroups, StartQuery, and GetQueryResults in order", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [{ logGroupName: "/ecs/svc/prod", storedBytes: 1024 }] } })
      .mockResolvedValueOnce({ body: { QueryId: "q-1" } })
      .mockResolvedValueOnce({ body: { Status: "Complete", Results: [] } });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(true);
    expect(callAws).toHaveBeenNthCalledWith(1, "cloudwatch-logs", "DescribeLogGroups", expect.objectContaining({ LogGroupNamePrefix: "/ecs/svc/prod" }));
    expect(callAws).toHaveBeenNthCalledWith(2, "cloudwatch-logs", "StartQuery", expect.objectContaining({ LogGroupName: "/ecs/svc/prod", QueryString: "fields @message" }));
    expect(callAws).toHaveBeenNthCalledWith(3, "cloudwatch-logs", "GetQueryResults", { QueryId: "q-1" });
  });

  it("populates scanBytesUsed from DescribeLogGroups storedBytes", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [{ logGroupName: "/ecs/svc/prod", storedBytes: 8192 }] } })
      .mockResolvedValueOnce({ body: { QueryId: "q-1" } })
      .mockResolvedValueOnce({ body: { Status: "Complete", Results: [] } });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.scanBytesUsed).toBe(8192);
  });

  it("polls through Running status before resolving on Complete", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [] } })
      .mockResolvedValueOnce({ body: { QueryId: "q-2" } })
      .mockResolvedValueOnce({ body: { Status: "Running", Results: [] } })
      .mockResolvedValueOnce({ body: { Status: "Running", Results: [] } })
      .mockResolvedValueOnce({ body: { Status: "Complete", Results: [] } });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(true);
    // DescribeLogGroups + StartQuery + 3x GetQueryResults
    expect(callAws).toHaveBeenCalledTimes(5);
  });

  it("sets truncated: true when result count equals limit", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => [
      { Field: "@timestamp", Value: "2026-05-01T10:00:00Z" },
      { Field: "@message", Value: JSON.stringify({ event: `e${i}` }) },
    ]);

    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [] } })
      .mockResolvedValueOnce({ body: { QueryId: "q-3" } })
      .mockResolvedValueOnce({ body: { Status: "Complete", Results: rows } });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 3, 0); // limit = 3
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("parses JSON log entries and counts unparsed entries", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [] } })
      .mockResolvedValueOnce({ body: { QueryId: "q-4" } })
      .mockResolvedValueOnce({
        body: {
          Status: "Complete",
          Results: [
            [{ Field: "@timestamp", Value: "2026-05-01T10:00:00Z" }, { Field: "@message", Value: '{"orderId":"ord-1"}' }],
            [{ Field: "@timestamp", Value: "2026-05-01T10:01:00Z" }, { Field: "@message", Value: "not json" }],
          ],
        },
      });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(true);
    const data = result.data as { entries: unknown[]; unparsedCount: number };
    expect(data.entries).toHaveLength(2);
    expect(data.unparsedCount).toBe(1);
  });

  it("returns error when StartQuery does not return a QueryId", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [] } })
      .mockResolvedValueOnce({ body: {} });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("QueryId");
  });

  it("returns error when StartQuery throws AwsToolkitError", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [] } })
      .mockRejectedValueOnce(new AwsToolkitError("ThrottlingException: rate exceeded"));

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ThrottlingException");
  });

  it("returns error when query ends with non-Complete status", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({ body: { logGroups: [] } })
      .mockResolvedValueOnce({ body: { QueryId: "q-5" } })
      .mockResolvedValueOnce({ body: { Status: "Failed", Results: [] } });

    const tool = new CloudWatchLogsToolV2(makeClient(callAws), 500, 0);
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed");
  });

  it("name matches legacy tool name string exactly", () => {
    const tool = new CloudWatchLogsToolV2(makeClient(vi.fn()), 500, 0);
    expect(tool.name).toBe("cloudwatch-logs");
  });

});
