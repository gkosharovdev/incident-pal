import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { ServiceCatalogTool } from "../../../src/tools/service-catalog/ServiceCatalogTool.js";

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
});
