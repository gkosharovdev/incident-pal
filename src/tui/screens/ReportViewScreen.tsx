import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { Investigation } from "../../models/index.js";

type ReportTab = "summary" | "hypotheses" | "actions" | "raw";

interface ReportViewScreenProps {
  readonly investigation: Investigation;
  readonly onNewInvestigation: () => void;
  readonly onBackToStream: () => void;
}

export function ReportViewScreen({
  investigation,
  onNewInvestigation,
  onBackToStream,
}: ReportViewScreenProps): React.JSX.Element {
  const [tab, setTab] = useState<ReportTab>("summary");
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;  // eslint-disable-line @typescript-eslint/no-unnecessary-condition
  const cols = stdout?.columns ?? 80;  // eslint-disable-line @typescript-eslint/no-unnecessary-condition

  const tabs: ReportTab[] = ["summary", "hypotheses", "actions", "raw"];

  useInput((_input, key) => {
    if (key.tab) {
      const idx = tabs.indexOf(tab);
      setTab(tabs[(idx + 1) % tabs.length] ?? "summary");
      return;
    }
    if (_input === "n") onNewInvestigation();
    if (_input === "b") onBackToStream();
  });

  const report = investigation.report;
  const statusColor = investigation.status === "complete" ? "green" : "yellow";

  return (
    <Box flexDirection="column" height={termRows}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="cyan">Investigation Report</Text>
        <Text color="gray">Tab: switch sections  N: new  B: back to stream  ,: settings</Text>
      </Box>

      <Box paddingX={1}>
        <Text>Status: <Text color={statusColor} bold>{investigation.status}</Text></Text>
        <Text> | Service: <Text color="white">{investigation.request.serviceId}</Text></Text>
        <Text> | Env: <Text color="white">{investigation.request.environment}</Text></Text>
      </Box>
      <Text>{"─".repeat(cols)}</Text>

      <Box paddingX={1}>
        {tabs.map((t) => (
          <Box key={t} marginRight={2}>
            <Text color={t === tab ? "cyan" : "gray"} bold={t === tab}>
              {t === tab ? "▶ " : "  "}{t}
            </Text>
          </Box>
        ))}
      </Box>
      <Text>{"─".repeat(cols)}</Text>

      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {renderTab(tab, investigation)}
      </Box>

      {report && (
        <Box paddingX={1}>
          <Text color="gray">
            Tools called: {report.metadata.toolCallsCount} |{" "}
            Scan: {(report.metadata.scanBytesUsed / 1024).toFixed(0)} KB /{" "}
            {(report.metadata.scanBudgetBytes / 1024).toFixed(0)} KB
          </Text>
        </Box>
      )}
    </Box>
  );
}

function renderTab(tab: ReportTab, investigation: Investigation): React.JSX.Element {
  if (tab === "summary") return renderSummaryTab(investigation.report);
  if (tab === "hypotheses") return renderHypothesesTab(investigation.hypotheses);
  if (tab === "actions") return renderActionsTab(investigation.report?.recommendedActions ?? []);
  return renderRawTab(investigation.report?.markdownContent ?? "No report content.");
}

function renderSummaryTab(report: Investigation["report"]): React.JSX.Element {
  if (!report) return <Text color="gray">No report available.</Text>;
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Likely Failure Point:</Text>
      {report.likelyFailurePoint ? (
        <Box marginLeft={2} flexDirection="column">
          <Text>{report.likelyFailurePoint.description}</Text>
          <Text color="gray">Confidence: {report.likelyFailurePoint.confidence}</Text>
        </Box>
      ) : (
        <Box marginLeft={2}><Text color="gray">Not determined</Text></Box>
      )}
      {report.metadata.uncertaintyFlags.length > 0 && (
        <>
          <Text bold>Uncertainty Flags:</Text>
          {report.metadata.uncertaintyFlags.map((flag, i) => (
            <Box key={i} marginLeft={2}><Text color="yellow">⚠ {flag}</Text></Box>
          ))}
        </>
      )}
    </Box>
  );
}

function renderHypothesesTab(hypotheses: Investigation["hypotheses"]): React.JSX.Element {
  if (hypotheses.length === 0) return <Text color="gray">No hypotheses formed.</Text>;
  return (
    <Box flexDirection="column" gap={1}>
      {hypotheses.map((h, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text color={h.confidence === "high" ? "green" : h.confidence === "medium" ? "yellow" : "gray"}>
            [{h.confidence.toUpperCase()}] {h.description}
          </Text>
          {h.supportingEvidence.length > 0 && (
            <Box marginLeft={2} flexDirection="column">
              {h.supportingEvidence.slice(0, 2).map((e, j) => (
                <Text key={j} color="gray">• {e.description}</Text>
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

function renderActionsTab(actions: string[]): React.JSX.Element {
  if (actions.length === 0) return <Text color="gray">No recommended actions.</Text>;
  return (
    <Box flexDirection="column">
      {actions.map((action, i) => (
        <Text key={i}>  {i + 1}. {action}</Text>
      ))}
    </Box>
  );
}

function renderRawTab(content: string): React.JSX.Element {
  const lines = content.split("\n").slice(0, 30);
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      {content.split("\n").length > 30 && (
        <Text color="gray">[… {content.split("\n").length - 30} more lines]</Text>
      )}
    </Box>
  );
}
