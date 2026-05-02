import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// These tests exercise headless mode validation logic directly to avoid
// spawning a full Ink process which requires a TTY.
describe("TUI headless credential validation", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AWS_PROFILE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("validates successfully when both env vars are set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    vi.stubEnv("AWS_PROFILE", "default");

    const { validateHeadlessCredentials } = await import(
      "../../../src/tui/index.js"
    );
    const result = validateHeadlessCredentials();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports missing ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AWS_PROFILE", "default");

    const { validateHeadlessCredentials } = await import(
      "../../../src/tui/index.js"
    );
    const result = validateHeadlessCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ANTHROPIC_API_KEY");
  });

  it("reports missing AWS_PROFILE", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    vi.stubEnv("AWS_PROFILE", "");

    const { validateHeadlessCredentials } = await import(
      "../../../src/tui/index.js"
    );
    const result = validateHeadlessCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("AWS_PROFILE");
  });

  it("reports both missing when neither env var is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AWS_PROFILE", "");

    const { validateHeadlessCredentials } = await import(
      "../../../src/tui/index.js"
    );
    const result = validateHeadlessCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(2);
  });
});
