import { describe, it, expect, vi } from "vitest";
import { EcsDeploymentTool } from "../../../src/tools/ecs/EcsDeploymentTool.js";
import type { ECSClient } from "@aws-sdk/client-ecs";

function makeClient(response: unknown): ECSClient {
  return {
    send: vi.fn().mockResolvedValue(response),
  } as unknown as ECSClient;
}

const TIME_FROM = "2026-04-30T10:00:00.000Z";
const TIME_TO = "2026-04-30T11:00:00.000Z";
const DEPLOY_TIME = "2026-04-30T10:30:00.000Z";

describe("EcsDeploymentTool", () => {
  it("returns deployments within time window", async () => {
    const client = makeClient({
      services: [
        {
          serviceName: "order-service",
          runningCount: 3,
          desiredCount: 3,
          deployments: [
            {
              id: "dep-1",
              status: "PRIMARY",
              taskDefinition: "order-service:42",
              createdAt: new Date(DEPLOY_TIME),
              updatedAt: new Date(DEPLOY_TIME),
              runningCount: 3,
              desiredCount: 3,
            },
          ],
        },
      ],
    });
    const tool = new EcsDeploymentTool(client);

    const result = await tool.invoke({
      clusterName: "main-cluster",
      serviceName: "order-service",
      from: TIME_FROM,
      to: TIME_TO,
    });

    expect(result.success).toBe(true);
    const data = result.data as { deploymentsInWindow: unknown[] };
    expect(data.deploymentsInWindow).toHaveLength(1);
  });

  it("filters out deployments outside time window", async () => {
    const client = makeClient({
      services: [
        {
          serviceName: "order-service",
          runningCount: 3,
          desiredCount: 3,
          deployments: [
            {
              id: "dep-old",
              status: "PRIMARY",
              taskDefinition: "order-service:41",
              createdAt: new Date("2026-04-29T10:00:00Z"),
              updatedAt: new Date("2026-04-29T10:00:00Z"),
              runningCount: 3,
              desiredCount: 3,
            },
          ],
        },
      ],
    });
    const tool = new EcsDeploymentTool(client);

    const result = await tool.invoke({
      clusterName: "main-cluster",
      serviceName: "order-service",
      from: TIME_FROM,
      to: TIME_TO,
    });

    expect(result.success).toBe(true);
    const data = result.data as { deploymentsInWindow: unknown[] };
    expect(data.deploymentsInWindow).toHaveLength(0);
  });

  it("returns error when service not found", async () => {
    const client = makeClient({ services: [] });
    const tool = new EcsDeploymentTool(client);

    const result = await tool.invoke({
      clusterName: "main-cluster",
      serviceName: "ghost-service",
      from: TIME_FROM,
      to: TIME_TO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ghost-service");
  });

  it("returns error on API failure", async () => {
    const client = {
      send: vi.fn().mockRejectedValue(new Error("AccessDenied")),
    } as unknown as ECSClient;
    const tool = new EcsDeploymentTool(client);

    const result = await tool.invoke({
      clusterName: "main-cluster",
      serviceName: "order-service",
      from: TIME_FROM,
      to: TIME_TO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("AccessDenied");
  });
});
