import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { SetupWizardScreen } from "../../../src/tui/screens/SetupWizardScreen.js";

vi.mock("../../../src/tui/hooks/useAwsProfiles.js", () => ({
  useAwsProfiles: (): { profiles: string[]; loading: boolean; error: null } =>
    ({ profiles: ["default", "staging"], loading: false, error: null }),
}));

describe("SetupWizardScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders step 1 API key input on mount", () => {
    const { lastFrame } = render(
      <SetupWizardScreen onComplete={vi.fn()} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("First-run Setup");
    expect(frame).toContain("Anthropic API Key");
  });

  it("calls onComplete with correct config when wizard completes", async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      <SetupWizardScreen onComplete={onComplete} />,
    );

    // Type an API key and press Enter to advance
    stdin.write("sk-ant-test-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    // Now on profile selector step, press Enter to confirm
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    // Now on confirm step, press Enter to save
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ anthropicApiKey: "sk-ant-test-key" }),
    );
  });

  it("does not advance from step 1 when API key is empty", async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      <SetupWizardScreen onComplete={onComplete} />,
    );

    // Press Enter without typing anything
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    // Should still be on step 1
    expect(lastFrame()).toContain("Anthropic API Key");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
