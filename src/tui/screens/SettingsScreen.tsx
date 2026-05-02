import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MaskedInput } from "../components/MaskedInput.js";
import { AwsProfileSelector } from "../components/AwsProfileSelector.js";
import { useAwsProfiles } from "../hooks/useAwsProfiles.js";
import type { CredentialConfig } from "../services/KeychainService.js";

type SettingsField = "api-key" | "aws-profile";

interface SettingsScreenProps {
  readonly currentCredentials: CredentialConfig | null;
  readonly onSave: (config: CredentialConfig) => Promise<void>;
  readonly onBack: () => void;
  readonly saving?: boolean;
  readonly saveError?: string | null;
}

export function SettingsScreen({
  currentCredentials,
  onSave,
  onBack,
  saving = false,
  saveError = null,
}: SettingsScreenProps): React.JSX.Element {
  const [apiKey, setApiKey] = useState(currentCredentials?.anthropicApiKey ?? "");
  const [focusedField, setFocusedField] = useState<SettingsField>("api-key");
  const { profiles, loading: profilesLoading } = useAwsProfiles();
  const currentProfileIndex = profiles.indexOf(currentCredentials?.awsProfile ?? "");
  const [profileIndex, setProfileIndex] = useState(Math.max(0, currentProfileIndex));

  const selectedProfile = profiles[profileIndex] ?? "";

  function handleSave(): void {
    if (apiKey.trim().length > 0 && selectedProfile) {
      void onSave({ anthropicApiKey: apiKey.trim(), awsProfile: selectedProfile });
    }
  }

  useInput((_input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.tab) { setFocusedField((f) => f === "api-key" ? "aws-profile" : "api-key"); return; }
    if (key.return && !key.ctrl) handleSave();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Settings</Text>
        <Text color="gray">Esc to go back</Text>
      </Box>
      <Text> </Text>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <MaskedInput
          label="Anthropic API Key"
          value={apiKey}
          onChange={setApiKey}
          isFocused={focusedField === "api-key"}
          placeholder="sk-ant-..."
        />
        <Text> </Text>
        {profilesLoading ? (
          <Text color="gray">Loading AWS profiles...</Text>
        ) : (
          <AwsProfileSelector
            profiles={profiles}
            selectedIndex={profileIndex}
            onSelect={setProfileIndex}
            isFocused={focusedField === "aws-profile"}
          />
        )}
        <Text> </Text>
        <SettingsFooter saving={saving} saveError={saveError} />
      </Box>
    </Box>
  );
}

function SettingsFooter({
  saving,
  saveError,
}: { saving: boolean; saveError: string | null | undefined }): React.JSX.Element {
  if (saving) return <Text color="yellow">Saving to keychain...</Text>;
  if (saveError) return <Text color="red">Error: {saveError}</Text>;
  return <Text color="gray">Tab to switch fields, Enter to save</Text>;
}
