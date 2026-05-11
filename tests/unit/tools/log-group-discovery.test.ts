import { describe, it, expect, vi } from "vitest";
import { LogGroupDiscoveryTool } from "../../../src/tools/cloudwatch/LogGroupDiscoveryTool.js";
import type { DiscoveredGroup } from "../../../src/tools/cloudwatch/LogGroupDiscoveryTool.js";
import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

function makeClient(
  describeLogGroups: (cmd: unknown) => Promise<{ logGroups?: Array<{ logGroupName?: string }>; nextToken?: string }>,
): CloudWatchLogsClient {
  return {
    send: vi.fn().mockImplementation((cmd: unknown) => describeLogGroups(cmd)),
  } as unknown as CloudWatchLogsClient;
}

function makeErrorClient(errorOverride: object): CloudWatchLogsClient {
  return {
    send: vi.fn().mockRejectedValue(Object.assign(new Error("AWS error"), errorOverride)),
  } as unknown as CloudWatchLogsClient;
}

describe("LogGroupDiscoveryTool — unit tests (T009)", () => {
  it("returns matching groups for a prefix filter", async () => {
    const client = makeClient(() =>
      Promise.resolve({
        logGroups: [
          { logGroupName: "/ecs/booking-service/prod" },
          { logGroupName: "/ecs/booking-service/proxy" },
        ],
      }),
    );
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/booking-service" }] });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[]; capped: boolean };
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0]?.name).toBe("/ecs/booking-service/prod");
    expect(data.groups[0]?.filter.type).toBe("prefix");
    expect(data.capped).toBe(false);
  });

  it("returns matching groups for a pattern filter", async () => {
    const client = makeClient(() =>
      Promise.resolve({
        logGroups: [{ logGroupName: "/aws/rds/proxy/booking-service" }],
      }),
    );
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "pattern", value: "booking-service" }] });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[] };
    expect(data.groups[0]?.name).toBe("/aws/rds/proxy/booking-service");
    expect(data.groups[0]?.filter.type).toBe("pattern");
  });

  it("returns success with empty groups when no log groups match", async () => {
    const client = makeClient(() => Promise.resolve({ logGroups: [] }));
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/nonexistent" }] });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[]; capped: boolean };
    expect(data.groups).toHaveLength(0);
    expect(data.capped).toBe(false);
  });

  it("sets capped and truncated when maxGroups limit is hit", async () => {
    const groups = Array.from({ length: 3 }, (_, i) => ({ logGroupName: `/group/${i}` }));
    const client = makeClient(() => Promise.resolve({ logGroups: groups }));
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/group" }], maxGroups: 2 });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[]; capped: boolean };
    expect(data.groups).toHaveLength(2);
    expect(data.capped).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("de-duplicates groups that match multiple filters", async () => {
    const client = makeClient(() =>
      Promise.resolve({ logGroups: [{ logGroupName: "/ecs/booking-service/prod" }] }),
    );
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({
      filters: [
        { type: "prefix", value: "/ecs/booking-service" },
        { type: "pattern", value: "booking-service" },
      ],
    });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[] };
    const names = data.groups.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n === "/ecs/booking-service/prod")).toHaveLength(1);
  });

  it("returns success with empty groups and warning for AccessDeniedException", async () => {
    const client = makeErrorClient({ name: "AccessDeniedException" });
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/booking-service" }] });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[]; warning?: string };
    expect(data.groups).toHaveLength(0);
    expect(data.warning).toBeDefined();
    expect(data.warning).toContain("AccessDeniedException");
  });

  it("returns success with empty groups and warning for ResourceNotFoundException", async () => {
    const client = makeErrorClient({ name: "ResourceNotFoundException" });
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/missing" }] });
    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[]; warning?: string };
    expect(data.groups).toHaveLength(0);
    expect(data.warning).toBeDefined();
  });

  it("returns success: false for unexpected AWS errors", async () => {
    const client = makeErrorClient({ name: "InternalServerError" });
    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({ filters: [{ type: "prefix", value: "/ecs/booking-service" }] });
    expect(result.success).toBe(false);
    expect(result.error).toContain("DescribeLogGroups failed");
  });
});

describe("LogGroupDiscoveryTool — recorded fixture integration test (T009b)", () => {
  it("parses a realistic DescribeLogGroups response correctly", async () => {
    // Recorded fixture: realistic AWS SDK response shape for DescribeLogGroupsCommand
    const fixtureResponse = {
      logGroups: [
        {
          logGroupName: "/ecs/booking-service/prod",
          creationTime: 1700000000000,
          retentionInDays: 30,
          storedBytes: 1048576,
          arn: "arn:aws:logs:eu-west-1:123456789012:log-group:/ecs/booking-service/prod:*",
        },
        {
          logGroupName: "/ecs/booking-service/proxy",
          creationTime: 1700000100000,
          retentionInDays: 14,
          storedBytes: 2097152,
          arn: "arn:aws:logs:eu-west-1:123456789012:log-group:/ecs/booking-service/proxy:*",
        },
      ],
      nextToken: undefined,
    };
    const client = makeClient(() => Promise.resolve(fixtureResponse));
    const tool = new LogGroupDiscoveryTool(client);

    const result = await tool.invoke({
      filters: [{ type: "prefix", value: "/ecs/booking-service" }],
    });

    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[]; capped: boolean; totalFound: number };
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0]).toEqual({
      name: "/ecs/booking-service/prod",
      filter: { type: "prefix", value: "/ecs/booking-service" },
    });
    expect(data.groups[1]).toEqual({
      name: "/ecs/booking-service/proxy",
      filter: { type: "prefix", value: "/ecs/booking-service" },
    });
    expect(data.capped).toBe(false);
    expect(data.totalFound).toBe(2);
  });

  it("handles paginated responses by following nextToken until exhausted", async () => {
    let callCount = 0;
    const client: CloudWatchLogsClient = {
      send: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            logGroups: [{ logGroupName: "/ecs/booking-service/prod" }],
            nextToken: "page-2-token",
          });
        }
        return Promise.resolve({
          logGroups: [{ logGroupName: "/ecs/booking-service/proxy" }],
          nextToken: undefined,
        });
      }),
    } as unknown as CloudWatchLogsClient;

    const tool = new LogGroupDiscoveryTool(client);
    const result = await tool.invoke({
      filters: [{ type: "prefix", value: "/ecs/booking-service" }],
    });

    expect(result.success).toBe(true);
    const data = result.data as { groups: DiscoveredGroup[] };
    expect(data.groups).toHaveLength(2);
    expect(callCount).toBe(2);
  });
});
