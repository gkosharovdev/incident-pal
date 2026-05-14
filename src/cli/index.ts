#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { InvestigationAgent } from "../agent/InvestigationAgent.js";
import { AwsToolkitClient } from "../tools/aws-toolkit/AwsToolkitClient.js";
import { CloudWatchLogsToolV2 } from "../tools/aws-toolkit/CloudWatchLogsToolV2.js";
import { LogGroupDiscoveryToolV2 } from "../tools/aws-toolkit/LogGroupDiscoveryToolV2.js";
import { EcsDeploymentToolV2 } from "../tools/aws-toolkit/EcsDeploymentToolV2.js";
import { ServiceCatalogTool } from "../tools/service-catalog/ServiceCatalogTool.js";
import type { LinkingKey, InvestigationRequest } from "../models/index.js";

interface InvestigateOpts {
  service: string;
  env: string;
  entityId?: string;
  httpCorrelationId?: string;
  kafkaMessageId?: string;
  from?: string;
  to?: string;
  description?: string;
}

function buildLinkingKeys(opts: InvestigateOpts): LinkingKey[] | string {
  const keys: LinkingKey[] = [];
  if (opts.entityId) {
    const parts = opts.entityId.split(":");
    if (parts.length < 2) {
      return "--entity-id must be in format type:id (e.g. order:ord-12345)";
    }
    const entityType = parts[0] ?? "";
    const value = parts.slice(1).join(":");
    keys.push({ type: "entity-id", entityType, value });
  }
  if (opts.httpCorrelationId) {
    keys.push({ type: "http-correlation", value: opts.httpCorrelationId });
  }
  if (opts.kafkaMessageId) {
    keys.push({ type: "kafka-message-id", value: opts.kafkaMessageId });
  }
  if (keys.length === 0) {
    return "At least one of --entity-id, --http-correlation-id, or --kafka-message-id is required";
  }
  return keys;
}

function buildRequest(opts: InvestigateOpts, linkingKeys: LinkingKey[]): InvestigationRequest | string {
  const environment = opts.env as InvestigationRequest["environment"];
  if (!["prod", "dev"].includes(environment)) {
    return `Invalid environment: ${opts.env}. Must be prod or dev`;
  }
  const request: InvestigationRequest = {
    serviceId: opts.service,
    environment,
    linkingKeys,
    ...(opts.from && opts.to ? { timeWindow: { from: opts.from, to: opts.to } } : {}),
    ...(opts.description ? { observationDescription: opts.description } : {}),
  };
  return request;
}

function applyEnvOptions(request: InvestigationRequest): { request: InvestigationRequest; maxDurationMs: number | undefined } {
  const maxIterations = process.env["MAX_ITERATIONS"]
    ? parseInt(process.env["MAX_ITERATIONS"], 10)
    : undefined;
  const maxDurationMs = process.env["MAX_DURATION_MS"]
    ? parseInt(process.env["MAX_DURATION_MS"], 10)
    : undefined;
  const finalRequest = maxIterations !== undefined
    ? { ...request, options: { ...request.options, maxIterations } }
    : request;
  return { request: finalRequest, maxDurationMs };
}

const program = new Command();

program
  .name("incident-pal")
  .description("Production investigation agent for AWS ECS services")
  .version("0.1.0");

program
  .command("investigate")
  .description("Run a production investigation")
  .requiredOption("--service <serviceId>", "Service identifier (must exist in service catalog)")
  .requiredOption("--env <environment>", "Target environment (prod|dev)")
  .option("--entity-id <type:id>", "Entity identifier in format type:id (e.g. order:ord-12345)")
  .option("--http-correlation-id <id>", "HTTP request correlation ID")
  .option("--kafka-message-id <id>", "Kafka message ID")
  .option("--from <datetime>", "Investigation start time (ISO 8601) — optional, defaults to past 60 minutes")
  .option("--to <datetime>", "Investigation end time (ISO 8601) — optional, defaults to now")
  .option("--description <text>", "Optional description of the observed problem")
  .action(async (opts: InvestigateOpts) => {
    const keysOrError = buildLinkingKeys(opts);
    if (typeof keysOrError === "string") {
      console.error(keysOrError);
      process.exit(1);
    }

    const requestOrError = buildRequest(opts, keysOrError);
    if (typeof requestOrError === "string") {
      console.error(requestOrError);
      process.exit(1);
    }

    const { request, maxDurationMs } = applyEnvOptions(requestOrError);
    const catalogPath = process.env["SERVICE_CATALOG_PATH"] ?? join(process.cwd(), "service-catalog.yml");
    const proxyUrl = process.env["MCP_PROXY_URL"];
    if (!proxyUrl) {
      console.error("MCP_PROXY_URL environment variable is required");
      process.exit(1);
    }

    const toolkit = new AwsToolkitClient(proxyUrl);
    await toolkit.connect();
    const agent = new InvestigationAgent({
      tools: [
        new CloudWatchLogsToolV2(toolkit),
        new LogGroupDiscoveryToolV2(toolkit),
        new EcsDeploymentToolV2(toolkit),
        new ServiceCatalogTool(catalogPath),
      ],
      maxDurationMs,
    });

    let investigation;
    try {
      investigation = await agent.investigate(request);
    } catch (err) {
      await toolkit.dispose();
      console.error(`Investigation failed: ${String(err)}`);
      process.exit(1);
    }

    await toolkit.dispose();

    if (investigation.report) {
      process.stdout.write(investigation.report.markdownContent + "\n");
    }

    mkdirSync("traces", { recursive: true });
    const tracePath = join("traces", `${investigation.id}.json`);
    writeFileSync(
      tracePath,
      JSON.stringify(
        { investigationId: investigation.id, status: investigation.status, entries: investigation.trace.getEntries() },
        null,
        2,
      ),
    );
    process.stderr.write(`Trace written to ${tracePath}\n`);
  });

program
  .command("tui")
  .description("Launch the interactive terminal UI")
  .option("--headless", "Force headless credential-validation mode (no interactive UI)", false)
  .action((opts: { headless: boolean }) => {
    // Dynamic import keeps the TUI's React/Ink deps out of the main agent bundle.
    import("../tui/index.js").then(({ launchTui }) => {
      launchTui({ headless: opts.headless });
    }).catch((err: unknown) => {
      console.error(`Failed to start TUI: ${String(err)}`);
      process.exit(1);
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
