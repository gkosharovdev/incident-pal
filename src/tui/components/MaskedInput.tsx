import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface MaskedInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly isFocused?: boolean;
  readonly placeholder?: string;
}

export function MaskedInput({
  label,
  value,
  onChange,
  isFocused = false,
  placeholder = "",
}: MaskedInputProps): React.JSX.Element {
  const [showCursor] = useState(true);

  useInput(
    (input, key) => {
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }
      if (key.return || key.tab || key.upArrow || key.downArrow) return;
      if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive: isFocused },
  );

  const masked = value.length > 0 ? "•".repeat(value.length) : "";
  const displayText = masked || (isFocused ? "" : placeholder);
  const cursorSuffix = isFocused && showCursor ? "▌" : "";

  return (
    <Box>
      <Text color={isFocused ? "cyan" : "white"}>{label}: </Text>
      <Text color={value.length > 0 ? "white" : "gray"}>
        {displayText}
        {cursorSuffix}
      </Text>
    </Box>
  );
}
