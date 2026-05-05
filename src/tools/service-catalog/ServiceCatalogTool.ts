import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";
import type { LinkingKeyType } from "../../models/LinkingKey.js";

export interface LogGroupFilter {
  type: "prefix" | "pattern";
  value: string;
}

const VALID_FILTER_TYPES = new Set(["prefix", "pattern"]);
const DEFAULT_MAX_LOG_GROUPS = 50;

interface ServiceEntry {
  id: string;
  displayName: string;
  environments: string[];
  logGroups?: Record<string, string>;
  logGroupFilters?: Record<string, LogGroupFilter[]>;
  maxLogGroups?: number;
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
  logGroupFilters: LogGroupFilter[];
  maxLogGroups: number;
  ecsCluster: string;
  linkingKeySchema: Record<string, LinkingKeyType>;
}

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    serviceId: { type: "string", description: "Service identifier to look up" },
    environment: {
      type: "string",
      enum: ["prod", "dev"],
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

function validateFilters(serviceId: string, env: string, filters: unknown[]): LogGroupFilter[] {
  return filters.map((f, i) => {
    const raw = f as Record<string, unknown>;
    const type = raw["type"];
    const value = raw["value"];
    if (!VALID_FILTER_TYPES.has(String(type))) {
      throw new Error(`INVALID_FILTER_TYPE: service '${serviceId}' env '${env}' filter[${i}] type '${String(type)}' must be 'prefix' or 'pattern'`);
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`INVALID_FILTER_VALUE: service '${serviceId}' env '${env}' filter[${i}] value must be a non-empty string`);
    }
    return { type: type as "prefix" | "pattern", value };
  });
}

function validateCatalog(catalog: ServiceCatalog): void {
  for (const service of catalog.services) {
    for (const env of service.environments) {
      const hasLegacy = service.logGroups?.[env] !== undefined;
      const rawFilters = service.logGroupFilters?.[env];
      const hasFilters = Array.isArray(rawFilters) && rawFilters.length > 0;
      if (!hasLegacy && !hasFilters) {
        throw new Error(`MISSING_LOG_GROUP_CONFIG: service '${service.id}' environment '${env}' has neither logGroups nor logGroupFilters`);
      }
      if (hasFilters) {
        validateFilters(service.id, env, rawFilters);
      }
    }
  }
}

function resolveFilters(service: ServiceEntry, env: string): LogGroupFilter[] {
  const rawFilters = service.logGroupFilters?.[env];
  if (Array.isArray(rawFilters) && rawFilters.length > 0) {
    return rawFilters;
  }
  const legacyGroup = service.logGroups?.[env];
  if (legacyGroup) {
    return [{ type: "prefix", value: legacyGroup }];
  }
  return [];
}

export class ServiceCatalogTool implements Tool {
  readonly name = "service-catalog";
  readonly description =
    "Look up a service by ID and environment to retrieve its log group filters, ECS cluster, and linking key schema. Returns an error if the service or environment does not exist.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly catalog: ServiceCatalog;

  constructor(catalogPath: string) {
    const raw = readFileSync(catalogPath, "utf-8");
    this.catalog = yaml.load(raw) as ServiceCatalog;
    validateCatalog(this.catalog);
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

    const logGroupFilters = resolveFilters(service, parsed.environment);
    const logGroup = logGroupFilters[0]?.value ?? "";

    const result: ServiceLookupResult = {
      serviceId: service.id,
      displayName: service.displayName,
      environment: parsed.environment,
      logGroup,
      logGroupFilters,
      maxLogGroups: service.maxLogGroups ?? DEFAULT_MAX_LOG_GROUPS,
      ecsCluster: service.ecsCluster,
      linkingKeySchema: parseLinkingKeySchema(service.linkingKeySchema),
    };

    return Promise.resolve({ success: true, data: result, error: null });
  }

  resolve(serviceId: string, environment: string): ServiceLookupResult | null {
    const service = this.catalog.services.find((s) => s.id === serviceId);
    if (!service || !service.environments.includes(environment)) return null;
    const logGroupFilters = resolveFilters(service, environment);
    if (logGroupFilters.length === 0) return null;
    return {
      serviceId: service.id,
      displayName: service.displayName,
      environment,
      logGroup: logGroupFilters[0]?.value ?? "",
      logGroupFilters,
      maxLogGroups: service.maxLogGroups ?? DEFAULT_MAX_LOG_GROUPS,
      ecsCluster: service.ecsCluster,
      linkingKeySchema: parseLinkingKeySchema(service.linkingKeySchema),
    };
  }
}
