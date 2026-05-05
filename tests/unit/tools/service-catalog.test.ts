import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { ServiceCatalogTool } from "../../../src/tools/service-catalog/ServiceCatalogTool.js";

const CATALOG_PATH = join(process.cwd(), "service-catalog.yml");

describe("ServiceCatalogTool", () => {
  const tool = new ServiceCatalogTool(CATALOG_PATH);

  it("returns service metadata for known service + env", async () => {
    const result = await tool.invoke({ serviceId: "booking-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { serviceId: string; logGroup: string };
    expect(data.serviceId).toBe("booking-service");
    expect(data.logGroup).toBe("/ecs/booking-service/prod");
  });

  it("returns error for unknown service", async () => {
    const result = await tool.invoke({ serviceId: "ghost-service", environment: "prod" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("UNKNOWN_SERVICE");
  });

  it("returns error for unknown environment", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.invoke({ serviceId: "booking-service", environment: "canary" as any });
    expect(result.success).toBe(false);
    expect(result.error).toContain("canary");
  });

  it("exposes linkingKeySchema for the service", async () => {
    const result = await tool.invoke({ serviceId: "booking-service", environment: "prod" });
    expect(result.success).toBe(true);
    const data = result.data as { linkingKeySchema: Record<string, string> };
    expect(data.linkingKeySchema["bookingId"]).toBe("entity-id");
  });

  it("resolve() returns null for unknown service", () => {
    expect(tool.resolve("unknown-svc", "prod")).toBeNull();
  });

  it("resolve() returns service for valid input", () => {
    const resolved = tool.resolve("booking-service", "dev");
    expect(resolved).not.toBeNull();
    expect(resolved?.logGroup).toBe("/ecs/booking-service/dev");
  });
});
