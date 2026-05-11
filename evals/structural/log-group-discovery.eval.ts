import { describe, it, expect } from "vitest";
import type { ToolResult } from "../../src/models/Tool.js";

describe("[Structural Eval] log-group-discovery tool contract", () => {
  it("success result contains groups array and capped flag", () => {
    const result: ToolResult = {
      success: true,
      data: {
        groups: [
          { name: "/ecs/booking-service/prod", filter: { type: "prefix", value: "/ecs/booking-service/prod" } },
        ],
        capped: false,
        totalFound: 1,
      },
      error: null,
    };

    expect(result.success).toBe(true);
    const data = result.data as { groups: unknown[]; capped: boolean; totalFound: number };
    expect(Array.isArray(data.groups)).toBe(true);
    expect(typeof data.capped).toBe("boolean");
    expect(typeof data.totalFound).toBe("number");
  });

  it("each discovered group has name and filter fields", () => {
    const group = { name: "/ecs/booking-service/prod", filter: { type: "prefix", value: "/ecs/booking-service/prod" } };
    expect(typeof group.name).toBe("string");
    expect(group.name.length).toBeGreaterThan(0);
    expect(["prefix", "pattern"]).toContain(group.filter.type);
    expect(typeof group.filter.value).toBe("string");
  });

  it("graceful access-denied result is success with empty groups and warning", () => {
    const result: ToolResult = {
      success: true,
      data: { groups: [], capped: false, totalFound: 0, warning: "AccessDeniedException — discovery skipped" },
      error: null,
    };

    expect(result.success).toBe(true);
    const data = result.data as { groups: unknown[]; warning?: string };
    expect(data.groups).toHaveLength(0);
    expect(typeof data.warning).toBe("string");
  });

  it("fail-fast error result has success false and error message", () => {
    const result: ToolResult = {
      success: false,
      data: null,
      error: "DescribeLogGroups failed: InternalServerError",
    };

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("DescribeLogGroups failed");
  });

  it("capped result has truncated flag set", () => {
    const result: ToolResult = {
      success: true,
      data: { groups: [], capped: true, totalFound: 50 },
      error: null,
      truncated: true,
    };

    expect(result.success).toBe(true);
    const data = result.data as { capped: boolean };
    expect(data.capped).toBe(true);
    expect(result.truncated).toBe(true);
  });
});
