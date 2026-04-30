#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { InvestigationAgent } from "../agent/InvestigationAgent.js";
import { CloudWatchLogsTool } from "../tools/cloudwatch/CloudWatchLogsTool.js";
import { EcsDeploymentTool } from "../tools/ecs/EcsDeploymentTool.js";
import { ServiceCatalogTool } from "../tools/service-catalog/ServiceCatalogTool.js";
import type { LinkingKey, InvestigationRequest } from "../models/index.js";

const program = new Command();

program
  .name("incident-pal")
  .description("Production investigation agent for AWS ECS services")
  .version("0.1.0");

program
  .command("investigate")
  .description("Run a production investigation")
  .requiredOption("--service <serviceId>", "Service identifier (must exist in service catalog)")
  .requiredOption("--env <environment>", "Target environment (production|staging|canary)")
  .option("--entity-id <type:id>", "Entity identifier in format type:id (e.g. order:ord-12345)")
  .option("--http-correlation-id <id>", "HTTP request correlation ID")
  .option("--kafka-message-id <id>", "Kafka message ID")
  .option("--from <datetime>", "Investigation start time (ISO 8601) — optional, defaults to past 60 minutes")
  .option("--to <datetime>", "Investigation end time (ISO 8601) — optional, defaults to now")
  .option("--description <text>", "Optional description of the observed problem")
  .action(async (opts: {
    service: string;
    env: string;
    entityId?: string;
    httpCorrelationId?: string;
    kafkaMessageId?: string;
    from?: string;
    to?: string;
    description?: string;
  }) => {
    const linkingKeys: LinkingKey[] = [];

    if (opts.entityId) {
      const parts = opts.entityId.split(":");
      if (parts.length < 2) {
        console.error("--entity-id must be in format type:id (e.g. order:ord-12345)");
        process.exit(1);
      }
      const entityType = parts[0]!;
      const value = parts.slice(1).join(":");
      linkingKeys.push({ type: "entity-id", entityType, value });
    }

    if (opts.httpCorrelationId) {
      linkingKeys.push({ type: "http-correlation", value: opts.httpCorrelationId });
    }

    if (opts.kafkaMessageId) {
      linkingKeys.push({ type: "kafka-message-id", value: opts.kafkaMessageId });
    }

    if (linkingKeys.length === 0) {
      console.error("At least one of --entity-id, --http-correlation-id, or --kafka-message-id is required");
      process.exit(1);
    }

    const environment = opts.env as InvestigationRequest["environment"];
    if (!["production", "staging", "canary"].includes(environment)) {
      console.error(`Invalid environment: ${opts.env}. Must be production, staging, or canary`);
      process.exit(1);
    }

    const request: InvestigationRequest = {
      serviceId: opts.service,
      environment,
      linkingKeys,
      ...(opts.from && opts.to
        ? { timeWindow: { from: opts.from, to: opts.to } }
        : {}),
      ...(opts.description ? { observationDescription: opts.description } : {}),
    };

    const region = process.env["AWS_REGION"] ?? "us-east-1";
    const catalogPath =
      process.env["SERVICE_CATALOG_PATH"] ?? join(process.cwd(), "service-catalog.yml");
    const maxIterations = process.env["MAX_ITERATIONS"]
      ? parseInt(process.env["MAX_ITERATIONS"], 10)
      : undefined;
    const maxDurationMs = process.env["MAX_DURATION_MS"]
      ? parseInt(process.env["MAX_DURATION_MS"], 10)
      : undefined;

    if (maxIterations !== undefined) {
      request.options = { ...request.options, maxIterations };
    }

    const cwClient = new CloudWatchLogsClient({ region });
    const ecsClient = new ECSClient({ region });

    const agent = new InvestigationAgent({
      tools: [
        new CloudWatchLogsTool(cwClient),
        new EcsDeploymentTool(ecsClient),
        new ServiceCatalogTool(catalogPath),
      ],
      maxDurationMs,
    });

    let investigation;
    try {
      investigation = await agent.investigate(request);
    } catch (err) {
      console.error(`Investigation failed: ${String(err)}`);
      process.exit(1);
    }

    if (investigation.report) {
      process.stdout.write(investigation.report.markdownContent + "\n");
    }

    mkdirSync("traces", { recursive: true });
    const tracePath = join("traces", `${investigation.id}.json`);
    writeFileSync(
      tracePath,
      JSON.stringify(
        {
          investigationId: investigation.id,
          status: investigation.status,
          entries: investigation.trace.getEntries(),
        },
        null,
        2,
      ),
    );
    process.stderr.write(`Trace written to ${tracePath}\n`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
