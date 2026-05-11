import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { ServiceCatalogTool } from "../../../src/tools/service-catalog/ServiceCatalogTool.js";
import type { LogGroupFilter } from "../../../src/tools/service-catalog/ServiceCatalogTool.js";

const CATALOG_PATH = join(process.cwd(), "tests/fixtures/service-catalog-test.yml");

describe("ServiceCatalogTool", () => {
  const tool = new ServiceCatalogTool(CATALOG_PATH);

  it("returns service metadata for known service + env", async () => {
    const result = await tool.invoke({ serviceId: "alpha-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { serviceId: string; logGroup: string };
    expect(data.serviceId).toBe("alpha-service");
    expect(data.logGroup).toBe("/ecs/alpha-service/prod");
  });

  it("returns error for unknown service", async () => {
    const result = await tool.invoke({ serviceId: "ghost-service", environment: "prod" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("UNKNOWN_SERVICE");
  });

  it("returns error for unknown environment", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.invoke({ serviceId: "alpha-service", environment: "canary" as any });
    expect(result.success).toBe(false);
    expect(result.error).toContain("canary");
  });

  it("exposes linkingKeySchema for the service", async () => {
    const result = await tool.invoke({ serviceId: "alpha-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { linkingKeySchema: Record<string, string> };
    expect(data.linkingKeySchema["orderId"]).toBe("entity-id");
    expect(data.linkingKeySchema["traceId"]).toBe("http-correlation");
    expect(data.linkingKeySchema["messageId"]).toBe("kafka-message-id");
  });

  it("resolve() returns null for unknown service", () => {
    expect(tool.resolve("unknown-svc", "prod")).toBeNull();
  });

  it("resolve() returns null for unknown environment", () => {
    expect(tool.resolve("alpha-service", "staging")).toBeNull();
  });

  it("resolve() returns service for valid input", () => {
    const resolved = tool.resolve("beta-service", "dev");
    expect(resolved).not.toBeNull();
    expect(resolved?.logGroup).toBe("/ecs/beta-service/dev");
    expect(resolved?.ecsCluster).toBe("beta-cluster");
  });

  it("resolve() returns correct linkingKeySchema", () => {
    const resolved = tool.resolve("beta-service", "prod");
    expect(resolved?.linkingKeySchema["customerId"]).toBe("entity-id");
    expect(resolved?.linkingKeySchema["traceId"]).toBe("http-correlation");
  });

  // logGroupFilters coverage (T007)
  it("returns logGroupFilters for a logGroupFilters-based catalog entry", async () => {
    const result = await tool.invoke({ serviceId: "alpha-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { logGroupFilters: LogGroupFilter[]; maxLogGroups: number };
    expect(Array.isArray(data.logGroupFilters)).toBe(true);
    expect(data.logGroupFilters.length).toBeGreaterThanOrEqual(1);
    expect(data.logGroupFilters[0]?.type).toBe("prefix");
    expect(data.logGroupFilters[0]?.value).toBe("/ecs/alpha-service/prod");
  });

  it("synthesises a prefix filter from legacy logGroups entry", async () => {
    const result = await tool.invoke({ serviceId: "beta-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { logGroupFilters: LogGroupFilter[] };
    expect(data.logGroupFilters).toHaveLength(1);
    expect(data.logGroupFilters[0]).toEqual({ type: "prefix", value: "/ecs/beta-service/prod" });
  });

  it("defaults maxLogGroups to 50 when not set", async () => {
    const result = await tool.invoke({ serviceId: "beta-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { maxLogGroups: number };
    expect(data.maxLogGroups).toBe(50);
  });

  it("uses explicit maxLogGroups when set", async () => {
    const result = await tool.invoke({ serviceId: "alpha-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { maxLogGroups: number };
    expect(data.maxLogGroups).toBe(20);
  });

  it("resolve() includes logGroupFilters in result", () => {
    const resolved = tool.resolve("alpha-service", "dev");
    expect(resolved?.logGroupFilters).toBeDefined();
    expect(resolved?.logGroupFilters.length).toBeGreaterThanOrEqual(1);
    expect(resolved?.logGroupFilters[0]?.type).toBe("prefix");
  });

  it("throws INVALID_FILTER_TYPE at load time for bad filter type", () => {
    const tmpDir = join(process.cwd(), "tests/fixtures/tmp");
    mkdirSync(tmpDir, { recursive: true });
    const badCatalog = `
services:
  - id: bad-service
    displayName: Bad Service
    environments: [prod]
    logGroupFilters:
      prod:
        - type: unknown-type
          value: /some/group
    ecsCluster: c
    linkingKeySchema: {}
`;
    const tmpPath = join(tmpDir, "bad-catalog.yml");
    writeFileSync(tmpPath, badCatalog);
    expect(() => new ServiceCatalogTool(tmpPath)).toThrow("INVALID_FILTER_TYPE");
  });

  it("throws MISSING_LOG_GROUP_CONFIG at load time when neither field present", () => {
    const tmpDir = join(process.cwd(), "tests/fixtures/tmp");
    mkdirSync(tmpDir, { recursive: true });
    const badCatalog = `
services:
  - id: empty-service
    displayName: Empty Service
    environments: [prod]
    ecsCluster: c
    linkingKeySchema: {}
`;
    const tmpPath = join(tmpDir, "empty-catalog.yml");
    writeFileSync(tmpPath, badCatalog);
    expect(() => new ServiceCatalogTool(tmpPath)).toThrow("MISSING_LOG_GROUP_CONFIG");
  });
});
