import { describe, it, expect, vi } from "vitest";
import { LogGroupDiscoveryToolV2 } from "../../../src/tools/aws-toolkit/LogGroupDiscoveryToolV2.js";
import type { AwsToolkitClient } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";
import { AwsToolkitError } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";

function makeClient(
  callAws: (service: string, operation: string, params: Record<string, unknown>) => Promise<{ body: unknown }>,
): AwsToolkitClient {
  return { callAws: vi.fn().mockImplementation(callAws) } as unknown as AwsToolkitClient;
}

describe("LogGroupDiscoveryToolV2", () => {
  it("uses LogGroupNamePrefix for prefix filters", async () => {
    const callAws = vi.fn().mockResolvedValue({
      body: { logGroups: [{ logGroupName: "/ecs/booking-service/prod" }] },
    });
    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/booking-service" }] });

    expect(callAws).toHaveBeenCalledWith(
      "cloudwatch-logs",
      "DescribeLogGroups",
      expect.objectContaining({ LogGroupNamePrefix: "/ecs/booking-service" }),
    );
  });

  it("uses LogGroupNamePattern for pattern filters", async () => {
    const callAws = vi.fn().mockResolvedValue({ body: { logGroups: [] } });
    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    await tool.invoke({ filters: [{ type: "pattern", value: "booking" }] });

    expect(callAws).toHaveBeenCalledWith(
      "cloudwatch-logs",
      "DescribeLogGroups",
      expect.objectContaining({ LogGroupNamePattern: "booking" }),
    );
  });

  it("follows pagination via NextToken until exhausted", async () => {
    const callAws = vi.fn()
      .mockResolvedValueOnce({
        body: {
          logGroups: [{ logGroupName: "/ecs/svc/a" }],
          NextToken: "tok-1",
        },
      })
      .mockResolvedValueOnce({
        body: {
          logGroups: [{ logGroupName: "/ecs/svc/b" }],
        },
      });

    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/svc" }] });

    expect(result.success).toBe(true);
    const data = result.data as { groups: Array<{ name: string }> };
    expect(data.groups).toHaveLength(2);
    expect(callAws).toHaveBeenCalledTimes(2);
    expect(callAws).toHaveBeenNthCalledWith(2, "cloudwatch-logs", "DescribeLogGroups",
      expect.objectContaining({ NextToken: "tok-1" }),
    );
  });

  it("sets capped: true and truncated when group count hits HARD_MAX_GROUPS", async () => {
    const groups = Array.from({ length: 50 }, (_, i) => ({ logGroupName: `/ecs/svc/${i}` }));
    const callAws = vi.fn().mockResolvedValue({ body: { logGroups: groups, NextToken: "more" } });

    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/svc" }] });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    const data = result.data as { capped: boolean; groups: unknown[] };
    expect(data.capped).toBe(true);
    expect(data.groups).toHaveLength(50);
  });

  it("returns success with warning for AccessDeniedException", async () => {
    const callAws = vi.fn().mockRejectedValue(
      new AwsToolkitError("aws___call_aws failed: AccessDeniedException: not authorized"),
    );
    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/svc" }] });

    expect(result.success).toBe(true);
    const data = result.data as { warning: string };
    expect(data.warning).toContain("AccessDeniedException");
  });

  it("returns error for unexpected AwsToolkitError", async () => {
    const callAws = vi.fn().mockRejectedValue(
      new AwsToolkitError("aws___call_aws failed: InternalServerError"),
    );
    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/svc" }] });

    expect(result.success).toBe(false);
    expect(result.error).toContain("InternalServerError");
  });

  it("deduplicates log group names across filters", async () => {
    const callAws = vi.fn().mockResolvedValue({
      body: { logGroups: [{ logGroupName: "/ecs/svc/shared" }] },
    });
    const tool = new LogGroupDiscoveryToolV2(makeClient(callAws));
    const result = await tool.invoke({
      filters: [
        { type: "prefix", value: "/ecs/svc" },
        { type: "pattern", value: "svc" },
      ],
    });

    const data = result.data as { groups: unknown[] };
    expect(data.groups).toHaveLength(1);
  });

  it("name matches legacy tool name string exactly", () => {
    const tool = new LogGroupDiscoveryToolV2(makeClient(vi.fn()));
    expect(tool.name).toBe("log-group-discovery");
  });
});
