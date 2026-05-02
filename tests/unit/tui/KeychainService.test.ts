import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("keytar", () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
  },
}));

describe("KeychainService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when no credentials stored", async () => {
    const keytar = await import("keytar");
    vi.mocked(keytar.default.getPassword).mockResolvedValue(null);

    const { KeychainService } = await import("../../../src/tui/services/KeychainService.js");
    const svc = new KeychainService();
    const result = await svc.getCredentials();
    expect(result).toBeNull();
  });

  it("returns credentials when both keys are stored", async () => {
    const keytar = await import("keytar");
    vi.mocked(keytar.default.getPassword).mockImplementation((_service, account) => {
      if (account === "anthropic-api-key") return Promise.resolve("sk-ant-test");
      if (account === "aws-profile") return Promise.resolve("my-profile");
      return Promise.resolve(null);
    });

    const { KeychainService } = await import("../../../src/tui/services/KeychainService.js");
    const svc = new KeychainService();
    const result = await svc.getCredentials();
    expect(result).toEqual({ anthropicApiKey: "sk-ant-test", awsProfile: "my-profile" });
  });

  it("saves both keys to keychain", async () => {
    const keytar = await import("keytar");
    vi.mocked(keytar.default.setPassword).mockResolvedValue(undefined);

    const { KeychainService } = await import("../../../src/tui/services/KeychainService.js");
    const svc = new KeychainService();
    await svc.saveCredentials({ anthropicApiKey: "sk-ant-test", awsProfile: "staging" });

    expect(keytar.default.setPassword).toHaveBeenCalledWith(
      "incident-pal", "anthropic-api-key", "sk-ant-test",
    );
    expect(keytar.default.setPassword).toHaveBeenCalledWith(
      "incident-pal", "aws-profile", "staging",
    );
  });

  it("returns true from isAvailable when keytar loads", async () => {
    const { KeychainService } = await import("../../../src/tui/services/KeychainService.js");
    const svc = new KeychainService();
    const available = await svc.isAvailable();
    expect(available).toBe(true);
  });
});
