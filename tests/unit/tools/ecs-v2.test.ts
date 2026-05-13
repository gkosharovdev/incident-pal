import { describe, it, expect, vi } from "vitest";
import { EcsDeploymentToolV2 } from "../../../src/tools/aws-toolkit/EcsDeploymentToolV2.js";
import type { AwsToolkitClient } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";
import { AwsToolkitError } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";

function makeClient(
  callAws: (service: string, operation: string, params: Record<string, unknown>) => Promise<{ body: unknown }>,
): AwsToolkitClient {
  return { callAws: vi.fn().mockImplementation(callAws) } as unknown as AwsToolkitClient;
}

const BASE_INPUT = {
  clusterName: "booking-cluster",
  serviceName: "booking-service",
  from: "2026-05-01T08:00:00Z",
  to: "2026-05-01T09:00:00Z",
};

const DEPLOYMENT_IN_WINDOW = {
  id: "ecs-svc-1",
  status: "PRIMARY",
  taskDefinition: "booking-service:42",
  createdAt: "2026-05-01T08:10:00Z",
  updatedAt: "2026-05-01T08:15:00Z",
  runningCount: 3,
  desiredCount: 3,
};

const DEPLOYMENT_OUTSIDE_WINDOW = {
  id: "ecs-svc-0",
  status: "INACTIVE",
  taskDefinition: "booking-service:41",
  createdAt: "2026-05-01T07:00:00Z",
  updatedAt: "2026-05-01T07:05:00Z",
  runningCount: 0,
  desiredCount: 0,
};

describe("EcsDeploymentToolV2", () => {
  it("calls ecs:DescribeServices with cluster and services args", async () => {
    const callAws = vi.fn().mockResolvedValue({
      body: { services: [{ runningCount: 2, desiredCount: 2, deployments: [] }] },
    });
    const tool = new EcsDeploymentToolV2(makeClient(callAws));
    await tool.invoke(BASE_INPUT);

    expect(callAws).toHaveBeenCalledWith("ecs", "DescribeServices", {
      cluster: "booking-cluster",
      services: ["booking-service"],
    });
  });

  it("filters deployments to those within the time window", async () => {
    const callAws = vi.fn().mockResolvedValue({
      body: {
        services: [{
          runningCount: 3,
          desiredCount: 3,
          deployments: [DEPLOYMENT_IN_WINDOW, DEPLOYMENT_OUTSIDE_WINDOW],
        }],
      },
    });
    const tool = new EcsDeploymentToolV2(makeClient(callAws));
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(true);
    const data = result.data as { deploymentsInWindow: unknown[] };
    expect(data.deploymentsInWindow).toHaveLength(1);
    expect((data.deploymentsInWindow[0] as { deploymentId: string }).deploymentId).toBe("ecs-svc-1");
  });

  it("returns currentRunningCount and currentDesiredCount from the service", async () => {
    const callAws = vi.fn().mockResolvedValue({
      body: { services: [{ runningCount: 4, desiredCount: 5, deployments: [] }] },
    });
    const tool = new EcsDeploymentToolV2(makeClient(callAws));
    const result = await tool.invoke(BASE_INPUT);

    const data = result.data as { currentRunningCount: number; currentDesiredCount: number };
    expect(data.currentRunningCount).toBe(4);
    expect(data.currentDesiredCount).toBe(5);
  });

  it("returns error when service is not found in the response", async () => {
    const callAws = vi.fn().mockResolvedValue({ body: { services: [] } });
    const tool = new EcsDeploymentToolV2(makeClient(callAws));
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("booking-service");
    expect(result.error).toContain("booking-cluster");
  });

  it("returns error when callAws throws AwsToolkitError", async () => {
    const callAws = vi.fn().mockRejectedValue(
      new AwsToolkitError("ClusterNotFoundException: cluster not found"),
    );
    const tool = new EcsDeploymentToolV2(makeClient(callAws));
    const result = await tool.invoke(BASE_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ClusterNotFoundException");
  });

  it("name matches legacy tool name string exactly", () => {
    const tool = new EcsDeploymentToolV2(makeClient(vi.fn()));
    expect(tool.name).toBe("ecs-deployment");
  });
});
