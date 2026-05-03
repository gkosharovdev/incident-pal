import React from "react";
import { Box, Text, useInput } from "ink";

interface AwsProfileSelectorProps {
  readonly profiles: string[];
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
  readonly isFocused?: boolean;
  readonly label?: string;
}

export function AwsProfileSelector({
  profiles,
  selectedIndex,
  onSelect,
  isFocused = false,
  label = "AWS Profile",
}: AwsProfileSelectorProps): React.JSX.Element {
  useInput(
    (_input, key) => {
      if (key.upArrow) {
        onSelect(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        onSelect(Math.min(profiles.length - 1, selectedIndex + 1));
      }
    },
    { isActive: isFocused },
  );

  if (profiles.length === 0) {
    return (
      <Box>
        <Text color={isFocused ? "cyan" : "white"}>{label}: </Text>
        <Text color="gray">No profiles found in ~/.aws/credentials</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={isFocused ? "cyan" : "white"}>{label}:</Text>
      {profiles.map((profile, i) => (
        <Box key={profile} marginLeft={2}>
          <Text color={i === selectedIndex ? "green" : "white"}>
            {i === selectedIndex ? "▶ " : "  "}
            {profile}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
