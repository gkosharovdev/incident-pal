import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";
import type { AwsToolkitClient } from "./AwsToolkitClient.js";
import { AwsToolkitError } from "./AwsToolkitClient.js";

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    clusterName: { type: "string", description: "ECS cluster name" },
    serviceName: { type: "string", description: "ECS service name" },
    from: { type: "string", description: "ISO 8601 start of time window" },
    to: { type: "string", description: "ISO 8601 end of time window" },
  },
  required: ["clusterName", "serviceName", "from", "to"],
  additionalProperties: false,
};

interface EcsInput {
  clusterName: string;
  serviceName: string;
  from: string;
  to: string;
}

interface DeploymentRecord {
  deploymentId: string;
  status: string;
  taskDefinition: string;
  createdAt: string;
  updatedAt: string;
  runningCount: number;
  desiredCount: number;
}

interface EcsResult {
  serviceName: string;
  clusterName: string;
  deploymentsInWindow: DeploymentRecord[];
  currentRunningCount: number;
  currentDesiredCount: number;
}

interface AwsDeployment {
  id?: string;
  status?: string;
  taskDefinition?: string;
  createdAt?: string;
  updatedAt?: string;
  runningCount?: number;
  desiredCount?: number;
}

interface AwsService {
  runningCount?: number;
  desiredCount?: number;
  deployments?: AwsDeployment[];
}

interface DescribeServicesResponse {
  services?: AwsService[];
}

export class EcsDeploymentToolV2 implements Tool {
  readonly name = "ecs-deployment";
  readonly description =
    "Retrieve ECS deployment metadata for a service within a time window. Returns deployment events, task definition versions, and current running/desired counts. Useful for correlating deployments with observed issues.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: AwsToolkitClient;

  constructor(client: AwsToolkitClient) {
    this.client = client;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const params = input as EcsInput;
    const fromMs = new Date(params.from).getTime();
    const toMs = new Date(params.to).getTime();

    try {
      const result = await this.client.callAws<DescribeServicesResponse>(
        "ecs",
        "DescribeServices",
        { cluster: params.clusterName, services: [params.serviceName] },
      );

      const service = result.body.services?.[0];
      if (!service) {
        return {
          success: false,
          data: null,
          error: `ECS service '${params.serviceName}' not found in cluster '${params.clusterName}'`,
        };
      }

      const allDeployments = service.deployments ?? [];
      const deploymentsInWindow = allDeployments
        .filter((d) => {
          const updatedMs = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
          return updatedMs >= fromMs && updatedMs <= toMs;
        })
        .map((d): DeploymentRecord => ({
          deploymentId: d.id ?? "",
          status: d.status ?? "UNKNOWN",
          taskDefinition: d.taskDefinition ?? "",
          createdAt: d.createdAt ?? "",
          updatedAt: d.updatedAt ?? "",
          runningCount: d.runningCount ?? 0,
          desiredCount: d.desiredCount ?? 0,
        }));

      const data: EcsResult = {
        serviceName: params.serviceName,
        clusterName: params.clusterName,
        deploymentsInWindow,
        currentRunningCount: service.runningCount ?? 0,
        currentDesiredCount: service.desiredCount ?? 0,
      };

      return { success: true, data, error: null };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: `ECS DescribeServices failed: ${err instanceof AwsToolkitError ? err.message : String(err)}`,
      };
    }
  }
}
