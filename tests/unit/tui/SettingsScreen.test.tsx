import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { SettingsScreen } from "../../../src/tui/screens/SettingsScreen.js";

vi.mock("../../../src/tui/hooks/useAwsProfiles.js", () => ({
  useAwsProfiles: (): { profiles: string[]; loading: boolean; error: null } =>
    ({ profiles: ["default", "staging"], loading: false, error: null }),
}));

const currentCredentials = {
  anthropicApiKey: "sk-ant-existing",
  awsProfile: "default",
};

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders settings heading and masked key indicator", () => {
    const { lastFrame } = render(
      <SettingsScreen
        currentCredentials={currentCredentials}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain("Settings");
    expect(lastFrame()).toContain("Anthropic API Key");
  });

  it("calls onBack when Escape is pressed", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <SettingsScreen
        currentCredentials={currentCredentials}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={onBack}
      />,
    );

    stdin.write("\x1B"); // Escape
    await new Promise((r) => setTimeout(r, 50));

    expect(onBack).toHaveBeenCalled();
  });

  it("calls onSave when Enter is pressed with non-empty credentials", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { stdin } = render(
      <SettingsScreen
        currentCredentials={currentCredentials}
        onSave={onSave}
        onBack={vi.fn()}
      />,
    );

    // Tab to AWS profile field then press Enter
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ awsProfile: expect.any(String) }));
  });
});
