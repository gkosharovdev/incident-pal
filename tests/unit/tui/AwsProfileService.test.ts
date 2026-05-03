import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/shared-ini-file-loader", () => ({
  parseKnownFiles: vi.fn(),
}));

describe("AwsProfileService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns profile names from parsed ini file", async () => {
    const loader = await import("@aws-sdk/shared-ini-file-loader");
    vi.mocked(loader.parseKnownFiles).mockResolvedValue({
      default: { aws_access_key_id: "xxx" },
      staging: { aws_access_key_id: "yyy" },
    });

    const { AwsProfileService } = await import("../../../src/tui/services/AwsProfileService.js");
    const svc = new AwsProfileService();
    const profiles = await svc.listProfiles();
    expect(profiles).toContain("default");
    expect(profiles).toContain("staging");
  });

  it("returns empty array on error", async () => {
    const loader = await import("@aws-sdk/shared-ini-file-loader");
    vi.mocked(loader.parseKnownFiles).mockRejectedValue(new Error("File not found"));

    const { AwsProfileService } = await import("../../../src/tui/services/AwsProfileService.js");
    const svc = new AwsProfileService();
    const profiles = await svc.listProfiles();
    expect(profiles).toEqual([]);
  });
});
