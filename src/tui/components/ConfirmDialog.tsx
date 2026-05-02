import React from "react";
import { Box, Text, useInput } from "ink";

interface ConfirmDialogProps {
  readonly message: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Yes",
  cancelLabel = "No",
}: ConfirmDialogProps): React.JSX.Element {
  useInput((_input, key) => {
    if (_input.toLowerCase() === "y" || key.return) {
      onConfirm();
    } else if (_input.toLowerCase() === "n" || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
      <Text>{message}</Text>
      <Text> </Text>
      <Text>
        Press <Text color="green" bold>Y</Text> / Enter for {confirmLabel},{" "}
        <Text color="red" bold>N</Text> / Esc for {cancelLabel}
      </Text>
    </Box>
  );
}
