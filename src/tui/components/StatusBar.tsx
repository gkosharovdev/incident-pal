import React from "react";
import { Box, Text } from "ink";
import type { InvestigationStatus } from "../hooks/useInvestigation.js";

const STATUS_COLORS: Record<InvestigationStatus, string> = {
  idle: "gray",
  running: "cyan",
  complete: "green",
  "timed-out": "yellow",
  "budget-exhausted": "yellow",
  error: "red",
};

const STATUS_LABELS: Record<InvestigationStatus, string> = {
  idle: "Idle",
  running: "Running",
  complete: "Complete",
  "timed-out": "Timed Out",
  "budget-exhausted": "Budget Exhausted",
  error: "Error",
};

interface StatusBarProps {
  readonly status: InvestigationStatus;
  readonly iteration: number;
  readonly elapsedMs: number;
  readonly budgetPct: number;
}

export function StatusBar({
  status,
  iteration,
  elapsedMs,
  budgetPct,
}: StatusBarProps): React.JSX.Element {
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  const elapsed = formatElapsed(elapsedMs);

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box gap={2}>
        <Text>
          Status: <Text color={color} bold>{label}</Text>
        </Text>
        <Text color="gray">Steps: {iteration}</Text>
        <Text color="gray">Elapsed: {elapsed}</Text>
      </Box>
      {budgetPct > 0 && (
        <Text color={budgetPct > 80 ? "red" : budgetPct > 50 ? "yellow" : "gray"}>
          Budget: {budgetPct.toFixed(0)}%
        </Text>
      )}
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m${(s % 60).toString().padStart(2, "0")}s`;
}
