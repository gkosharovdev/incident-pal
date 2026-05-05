import React from "react";
import { Box, Text } from "ink";
import type { StreamEntry as StreamEntryData } from "../hooks/useInvestigation.js";
import type { TraceEntry } from "../../models/index.js";

const EVENT_COLORS: Partial<Record<TraceEntry["type"], string>> = {
  "tool-call": "cyan",
  "tool-error": "red",
  "tool-unavailable": "yellow",
  "linking-key-discovered": "green",
  "hypothesis-formed": "magenta",
  "investigation-complete": "green",
  "budget-exhausted": "yellow",
  "timed-out": "yellow",
  "result-truncated": "gray",
  "investigation-started": "blue",
};

interface StreamEntryProps {
  readonly entry: StreamEntryData;
  readonly isLast?: boolean;
}

export function StreamEntryRow({ entry, isLast = false }: StreamEntryProps): React.JSX.Element {
  const color = EVENT_COLORS[entry.eventType] ?? "white";
  const time = entry.timestamp.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const isError = entry.eventType === "tool-error" || entry.eventType === "tool-unavailable";

  return (
    <Box>
      <Text color="gray">{time} </Text>
      <Text color={color} bold={isError}>[{entry.label.padEnd(16)}]</Text>
      <Text bold={isError}> {entry.summary}</Text>
      {isLast && <Text color="gray"> ●</Text>}
    </Box>
  );
}
