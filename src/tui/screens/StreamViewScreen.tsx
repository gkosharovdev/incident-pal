import React from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { StreamEntryRow } from "../components/StreamEntry.js";
import { StatusBar } from "../components/StatusBar.js";
import type { StreamEntry, InvestigationStatus } from "../hooks/useInvestigation.js";
import type { Investigation } from "../../models/index.js";

interface StreamViewScreenProps {
  readonly entries: StreamEntry[];
  readonly status: InvestigationStatus;
  readonly iteration: number;
  readonly elapsedMs: number;
  readonly budgetPct: number;
  readonly onViewReport: (investigation: Investigation) => void;
  readonly onNewInvestigation: () => void;
  readonly investigation: Investigation | null;
}

export function StreamViewScreen({
  entries,
  status,
  iteration,
  elapsedMs,
  budgetPct,
  onViewReport,
  onNewInvestigation,
  investigation,
}: StreamViewScreenProps): React.JSX.Element {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
  // Reserve rows: 3 header + 2 status bar + 1 footer = 6
  const visibleRows = Math.max(1, termRows - 6);
  const visibleEntries = entries.slice(-visibleRows);

  useInput((_input, key) => {
    if ((key.return || _input === "r") && status !== "running" && investigation) {
      onViewReport(investigation);
    }
    if (_input === "n" && status !== "running") {
      onNewInvestigation();
    }
  });

  const isTerminal = status !== "running";

  return (
    <Box flexDirection="column" height={termRows}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="cyan">Live Investigation Stream</Text>
        <Text color="gray">
          {isTerminal
            ? "Enter/R: view report  N: new  Ctrl+S: settings"
            : "Running… (Ctrl+C to abort)"}
        </Text>
      </Box>
      <Text>{"─".repeat(stdout?.columns ?? 80) /* eslint-disable-line @typescript-eslint/no-unnecessary-condition */}</Text>

      <Box flexDirection="column" flexGrow={1}>
        {visibleEntries.length === 0 ? (
          <Text color="gray" dimColor>Waiting for events…</Text>
        ) : (
          visibleEntries.map((entry, i) => (
            <StreamEntryRow
              key={entry.id}
              entry={entry}
              isLast={i === visibleEntries.length - 1 && status === "running"}
            />
          ))
        )}
      </Box>

      <Text>{"─".repeat(stdout?.columns ?? 80) /* eslint-disable-line @typescript-eslint/no-unnecessary-condition */}</Text>
      <StatusBar
        status={status}
        iteration={iteration}
        elapsedMs={elapsedMs}
        budgetPct={budgetPct}
      />
    </Box>
  );
}
