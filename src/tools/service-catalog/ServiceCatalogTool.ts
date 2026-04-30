import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";
import type { LinkingKeyType } from "../../models/LinkingKey.js";

interface ServiceEntry {
  id: string;
  displayName: string;
  environments: string[];
  logGroups: Record<string, string>;
  ecsCluster: string;
  linkingKeySchema: Record<string, string>;
  observationTypes?: string[];
}

interface ServiceCatalog {
  services: ServiceEntry[];
}

interface ServiceLookupResult {
  serviceId: string;
  displayName: string;
  environment: string;
  logGroup: string;
  ecsCluster: string;
  linkingKeySchema: Record<string, LinkingKeyType>;
}

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    serviceId: { type: "string", description: "Service identifier to look up" },
    environment: {
      type: "string",
      enum: ["production", "staging", "canary"],
      description: "Target environment",
    },
  },
  required: ["serviceId", "environment"],
  additionalProperties: false,
};

const VALID_LINKING_KEY_TYPES = new Set<string>(["entity-id", "http-correlation", "kafka-message-id"]);

function isLinkingKeyType(value: string): value is LinkingKeyType {
  return VALID_LINKING_KEY_TYPES.has(value);
}

function parseLinkingKeySchema(raw: Record<string, string>): Record<string, LinkingKeyType> {
  const result: Record<string, LinkingKeyType> = {};
  for (const [field, typeStr] of Object.entries(raw)) {
    if (isLinkingKeyType(typeStr)) {
      result[field] = typeStr;
    }
  }
  return result;
}

export class ServiceCatalogTool implements Tool {
  readonly name = "service-catalog";
  readonly description =
    "Look up a service by ID and environment to retrieve its log group, ECS cluster, and linking key schema. Returns an error if the service or environment does not exist.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly catalog: ServiceCatalog;

  constructor(catalogPath: string) {
    const raw = readFileSync(catalogPath, "utf-8");
    this.catalog = yaml.load(raw) as ServiceCatalog;
  }

  invoke(input: unknown): Promise<ToolResult> {
    const parsed = input as { serviceId: string; environment: string };
    const service = this.catalog.services.find((s) => s.id === parsed.serviceId);

    if (!service) {
      return Promise.resolve({
        success: false,
        data: null,
        error: `UNKNOWN_SERVICE: Service '${parsed.serviceId}' not found in catalog`,
      });
    }

    if (!service.environments.includes(parsed.environment)) {
      return Promise.resolve({
        success: false,
        data: null,
        error: `Unknown environment '${parsed.environment}' for service '${parsed.serviceId}'`,
      });
    }

    const logGroup = service.logGroups[parsed.environment];
    if (!logGroup) {
      return Promise.resolve({
        success: false,
        data: null,
        error: `No log group configured for '${parsed.serviceId}' in '${parsed.environment}'`,
      });
    }

    const result: ServiceLookupResult = {
      serviceId: service.id,
      displayName: service.displayName,
      environment: parsed.environment,
      logGroup,
      ecsCluster: service.ecsCluster,
      linkingKeySchema: parseLinkingKeySchema(service.linkingKeySchema),
    };

    return Promise.resolve({ success: true, data: result, error: null });
  }

  resolve(serviceId: string, environment: string): ServiceLookupResult | null {
    const service = this.catalog.services.find((s) => s.id === serviceId);
    if (!service || !service.environments.includes(environment)) return null;
    const logGroup = service.logGroups[environment];
    if (!logGroup) return null;
    return {
      serviceId: service.id,
      displayName: service.displayName,
      environment,
      logGroup,
      ecsCluster: service.ecsCluster,
      linkingKeySchema: parseLinkingKeySchema(service.linkingKeySchema),
    };
  }
}
