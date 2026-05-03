import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MaskedInput } from "../components/MaskedInput.js";
import { AwsProfileSelector } from "../components/AwsProfileSelector.js";
import { useAwsProfiles } from "../hooks/useAwsProfiles.js";
import type { CredentialConfig } from "../services/KeychainService.js";

type WizardStep = "api-key" | "aws-profile" | "confirm";

interface SetupWizardScreenProps {
  readonly onComplete: (config: CredentialConfig) => void;
  readonly onCancel?: () => void;
  readonly saving?: boolean;
  readonly saveError?: string | null;
}

export function SetupWizardScreen({
  onComplete,
  onCancel,
  saving = false,
  saveError = null,
}: SetupWizardScreenProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>("api-key");
  const [apiKey, setApiKey] = useState("");
  const [profileIndex, setProfileIndex] = useState(0);
  const { profiles, loading: profilesLoading } = useAwsProfiles();

  const selectedProfile = profiles[profileIndex] ?? "";

  function advance(): void {
    if (step === "api-key" && apiKey.trim().length > 0) setStep("aws-profile");
    else if (step === "aws-profile" && profiles.length > 0) setStep("confirm");
    else if (step === "confirm") onComplete({ anthropicApiKey: apiKey.trim(), awsProfile: selectedProfile });
  }

  useInput((input, key) => {
    if (key.escape && onCancel) { onCancel(); return; }
    if (key.return || key.tab || input === "\t") advance();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">incident-pal — First-run Setup</Text>
      <Text> </Text>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <WizardProgress step={step} />
        <WizardStepContent
          step={step}
          apiKey={apiKey}
          setApiKey={setApiKey}
          profiles={profiles}
          profilesLoading={profilesLoading}
          profileIndex={profileIndex}
          setProfileIndex={setProfileIndex}
          selectedProfile={selectedProfile}
          saving={saving}
          saveError={saveError}
        />
      </Box>
    </Box>
  );
}

function WizardProgress({ step }: { step: WizardStep }): React.JSX.Element {
  return (
    <Box marginBottom={1}>
      <Text color="gray">Step 1/2: </Text>
      <Text color={step === "api-key" ? "cyan" : "green"}>Anthropic API Key</Text>
      <Text color="gray">  Step 2/2: </Text>
      <Text color={step === "aws-profile" || step === "confirm" ? "cyan" : "gray"}>AWS Profile</Text>
    </Box>
  );
}

function WizardStepContent({
  step, apiKey, setApiKey, profiles, profilesLoading,
  profileIndex, setProfileIndex, selectedProfile, saving, saveError,
}: {
  step: WizardStep; apiKey: string; setApiKey: (v: string) => void;
  profiles: string[]; profilesLoading: boolean; profileIndex: number;
  setProfileIndex: (i: number) => void; selectedProfile: string;
  saving: boolean; saveError: string | null;
}): React.JSX.Element {
  if (step === "api-key") {
    return (
      <Box flexDirection="column">
        <MaskedInput label="Anthropic API Key" value={apiKey} onChange={setApiKey} isFocused placeholder="sk-ant-..." />
        <Text> </Text>
        <Text color="gray">Press Enter to continue, Esc to cancel</Text>
      </Box>
    );
  }
  if (step === "aws-profile") {
    return (
      <Box flexDirection="column">
        {profilesLoading ? <Text color="gray">Loading AWS profiles...</Text> : (
          <AwsProfileSelector profiles={profiles} selectedIndex={profileIndex} onSelect={setProfileIndex} isFocused />
        )}
        <Text> </Text>
        <Text color="gray">↑↓ to select, Enter to continue, Esc to cancel</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>Review your settings:</Text>
      <Text> </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>API Key: <Text color="green">{"•".repeat(Math.min(apiKey.length, 8))}... (set)</Text></Text>
        <Text>AWS Profile: <Text color="green">{selectedProfile}</Text></Text>
      </Box>
      <Text> </Text>
      {saving && <Text color="yellow">Saving to keychain...</Text>}
      {saveError && <Text color="red">Error: {saveError}</Text>}
      {!saving && !saveError && <Text color="gray">Press Enter to save, Esc to go back</Text>}
    </Box>
  );
}
