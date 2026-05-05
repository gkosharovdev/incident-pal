import React from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { Key } from "ink";
import { StreamEntryRow } from "../components/StreamEntry.js";
import { StatusBar } from "../components/StatusBar.js";
import type { StreamEntry, InvestigationStatus } from "../hooks/useInvestigation.js";
import type { Investigation } from "../../models/index.js";

const STALE_THRESHOLD_MS = 15_000;

interface StreamViewScreenProps {
  readonly entries: StreamEntry[];
  readonly status: InvestigationStatus;
  readonly iteration: number;
  readonly elapsedMs: number;
  readonly budgetPct: number;
  readonly error: string | null;
  readonly onViewReport: (investigation: Investigation) => void;
  readonly onNewInvestigation: () => void;
  readonly investigation: Investigation | null;
}

// eslint-disable-next-line complexity
export function StreamViewScreen({
  entries,
  status,
  iteration,
  elapsedMs,
  budgetPct,
  error,
  onViewReport,
  onNewInvestigation,
  investigation,
}: StreamViewScreenProps): React.JSX.Element {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
  const cols = stdout?.columns ?? 80; // eslint-disable-line @typescript-eslint/no-unnecessary-condition

  const staleEntry = getStaleToolEntry(entries, status, elapsedMs);
  const extraRows = (staleEntry ? 1 : 0) + (error ? 1 : 0);
  // Reserve rows: 1 header + 1 separator + 1 separator + 1 status = 4, plus any alert rows
  const visibleRows = Math.max(1, termRows - 4 - extraRows);
  const visibleEntries = entries.slice(-visibleRows);

  useInput((input, key) => {
    handleStreamInput(input, key, status, investigation, onViewReport, onNewInvestigation);
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
      <Text>{"─".repeat(cols)}</Text>

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

      {staleEntry && <StaleWarning entry={staleEntry} />}
      {error && <ErrorBanner message={error} />}

      <Text>{"─".repeat(cols)}</Text>
      <StatusBar
        status={status}
        iteration={iteration}
        elapsedMs={elapsedMs}
        budgetPct={budgetPct}
      />
    </Box>
  );
}

function StaleWarning({ entry }: { entry: StreamEntry }): React.JSX.Element {
  return (
    <Box paddingX={1}>
      <Text color="yellow">
        {"⚠ "}
        <Text bold>Tool call stalled</Text>
        {` — ${entry.summary} has been running for ${formatStaleDuration(entry.timestamp)} (AWS or network may be unreachable)`}
      </Text>
    </Box>
  );
}

function ErrorBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <Box paddingX={1}>
      <Text color="red">
        {"✗ "}
        <Text bold>Fatal error</Text>
        {` — ${message}`}
      </Text>
    </Box>
  );
}

function handleStreamInput(
  input: string,
  key: Key,
  status: InvestigationStatus,
  investigation: Investigation | null,
  onViewReport: (inv: Investigation) => void,
  onNewInvestigation: () => void,
): void {
  if ((key.return || input === "r") && status !== "running" && investigation) {
    onViewReport(investigation);
  }
  if (input === "n" && status !== "running") {
    onNewInvestigation();
  }
}

function getStaleToolEntry(
  entries: StreamEntry[],
  status: InvestigationStatus,
  _elapsedMs: number,
): StreamEntry | null {
  if (status !== "running") return null;
  const last = entries.at(-1);
  if (!last || last.eventType !== "tool-call") return null;
  if (Date.now() - last.timestamp.getTime() >= STALE_THRESHOLD_MS) return last;
  return null;
}

function formatStaleDuration(since: Date): string {
  const s = Math.round((Date.now() - since.getTime()) / 1000);
  return `${s}s`;
}
