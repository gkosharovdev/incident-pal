import { Client } from "pg";
import { z } from "zod";
import type { Tool, ToolResult } from "../../../models/Tool.js";
import type { JSONSchema7 } from "../../../models/JSONSchema.js";
import { AuroraDbCatalogReader, type AuroraDatabaseConfig } from "./AuroraDbCatalogReader.js";
import { assertSelectOnly } from "./AuroraDbGuard.js";
import { resolvePassword } from "./AuroraDbCredentials.js";

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const BYTES_PER_ROW_ESTIMATE = 1024;

const InputSchema = z.object({
  serviceId: z.string().min(1),
  environment: z.enum(["production", "staging", "canary"]),
  query: z.string().min(1),
  maxRows: z.number().positive().optional(),
});

type AuroraDbInput = z.infer<typeof InputSchema>;

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    serviceId: { type: "string", minLength: 1, description: "Service identifier (must exist in service catalog)" },
    environment: {
      type: "string",
      enum: ["production", "staging", "canary"],
      description: "Target environment",
    },
    query: {
      type: "string",
      minLength: 1,
      description: "SQL SELECT statement to execute. Multi-table JOINs are supported; use column aliases (e.g. orders.status AS orders_status) to make the table source clear in the evidence report. CTEs (WITH ... SELECT) are not supported in v1.",
    },
    maxRows: {
      type: "number",
      description: "Override default row cap (optional, capped at the constructor maximum)",
    },
  },
  required: ["serviceId", "environment", "query"],
  additionalProperties: false,
};

export interface AuroraDbRow {
  [columnName: string]: string | number | boolean | null;
}

export interface AuroraDbResult {
  rows: AuroraDbRow[];
  rowCount: number;
  rowCap: number;
  truncated: boolean;
  queryExecutedMs: number;
  serviceId: string;
  environment: string;
}

interface PgQueryResult {
  rows: Record<string, unknown>[];
}

export interface PgClient {
  connect(): Promise<void>;
  query(text: string): Promise<PgQueryResult>;
  end(): Promise<void>;
}

interface PgClientConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: { rejectUnauthorized: boolean };
}

type PgClientFactory = (config: PgClientConfig) => PgClient;
type PasswordResolver = (config: AuroraDatabaseConfig) => Promise<string>;
type CatalogResolver = { resolve(serviceId: string, environment: string): AuroraDatabaseConfig | null };

export interface AuroraDbToolOptions {
  maxRows?: number;
  queryTimeoutMs?: number;
  pgClientFactory?: PgClientFactory;
  passwordResolver?: PasswordResolver;
  catalogReader?: CatalogResolver;
}

function defaultPgClientFactory(cfg: PgClientConfig): PgClient {
  return new Client(cfg) as unknown as PgClient;
}

export class AuroraDbTool implements Tool {
  readonly name = "aurora-db";
  readonly description =
    "Query an Aurora PostgreSQL database for a service under investigation. Returns structured row data for correlating database state with log evidence. SELECT statements only; multi-table JOINs supported; use column aliases to identify table sources. CTEs not supported in v1.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly catalogReader: CatalogResolver;
  private readonly maxRows: number;
  private readonly queryTimeoutMs: number;
  private readonly pgClientFactory: PgClientFactory;
  private readonly passwordResolver: PasswordResolver;

  constructor(catalogPath: string, options: AuroraDbToolOptions = {}) {
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.pgClientFactory = options.pgClientFactory ?? defaultPgClientFactory;
    this.passwordResolver = options.passwordResolver ?? resolvePassword;
    this.catalogReader = options.catalogReader ?? new AuroraDbCatalogReader(catalogPath);
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, data: null, error: `Invalid input: ${parsed.error.message}` };
    }

    try {
      assertSelectOnly(parsed.data.query);
    } catch (err) {
      return { success: false, data: null, error: String(err) };
    }

    const config = this.catalogReader.resolve(parsed.data.serviceId, parsed.data.environment);
    if (!config) {
      return {
        success: false,
        data: null,
        error: `NO_DB_CONFIGURED: No Aurora database configured for '${parsed.data.serviceId}' in '${parsed.data.environment}'`,
      };
    }

    let password: string;
    try {
      password = await this.passwordResolver(config);
    } catch (err) {
      return { success: false, data: null, error: String(err) };
    }

    return this.executeQuery(parsed.data, config, password);
  }

  private async executeQuery(
    input: AuroraDbInput,
    config: AuroraDatabaseConfig,
    password: string,
  ): Promise<ToolResult> {
    const rowCap = Math.min(input.maxRows ?? this.maxRows, this.maxRows);
    const client = this.pgClientFactory({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      await client.query(`SET statement_timeout = ${this.queryTimeoutMs}`);
      const queryStart = Date.now();
      const result = await client.query(input.query);
      const queryExecutedMs = Date.now() - queryStart;

      const allRows = result.rows as AuroraDbRow[];
      const truncated = allRows.length > rowCap;
      const rows = truncated ? allRows.slice(0, rowCap) : allRows;

      const data: AuroraDbResult = {
        rows,
        rowCount: rows.length,
        rowCap,
        truncated,
        queryExecutedMs,
        serviceId: input.serviceId,
        environment: input.environment,
      };

      return {
        success: true,
        data,
        error: null,
        scanBytesUsed: rows.length * BYTES_PER_ROW_ESTIMATE,
        truncated,
      };
    } catch (err) {
      return { success: false, data: null, error: `AuroraDb query failed: ${String(err)}` };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
