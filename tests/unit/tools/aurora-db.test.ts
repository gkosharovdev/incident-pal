import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuroraDbTool } from "../../../src/tools/extensions/aurora-db/AuroraDbTool.js";
import { AuroraDbCatalogReader } from "../../../src/tools/extensions/aurora-db/AuroraDbCatalogReader.js";
import { assertSelectOnly } from "../../../src/tools/extensions/aurora-db/AuroraDbGuard.js";
import type { PgClient } from "../../../src/tools/extensions/aurora-db/AuroraDbTool.js";
import type { AuroraDatabaseConfig } from "../../../src/tools/extensions/aurora-db/AuroraDbCatalogReader.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATALOG_CONFIG: AuroraDatabaseConfig = {
  host: "order-service.cluster-abc.eu-west-1.rds.amazonaws.com",
  port: 5432,
  database: "order_service_prod",
  username: "iam_user",
  region: "eu-west-1",
  credentialSource: "iam",
};

const VALID_INPUT = {
  serviceId: "order-service",
  environment: "production" as const,
  query: "SELECT id, status FROM orders WHERE id = 'ord-1'",
};

function makeCatalogReader(config: AuroraDatabaseConfig | null = CATALOG_CONFIG): {
  resolve: () => AuroraDatabaseConfig | null;
} {
  return { resolve: () => config };
}

function makePasswordResolver(password = "tok-iam"): () => Promise<string> {
  return () => Promise.resolve(password);
}

function makePgClient(overrides?: Partial<PgClient>): PgClient {
  return {
    connect: overrides?.connect ?? (() => Promise.resolve()),
    query: overrides?.query ?? (() => Promise.resolve({ rows: [] })),
    end: overrides?.end ?? (() => Promise.resolve()),
  };
}

function makeToolWithClient(
  clientOverrides?: Partial<PgClient>,
  options?: { maxRows?: number; catalogConfig?: AuroraDatabaseConfig | null },
): AuroraDbTool {
  const client = makePgClient(clientOverrides);
  return new AuroraDbTool("unused-path.yml", {
    maxRows: options?.maxRows ?? 100,
    catalogReader: makeCatalogReader(options?.catalogConfig ?? CATALOG_CONFIG),
    passwordResolver: makePasswordResolver(),
    pgClientFactory: () => client,
  });
}

// ---------------------------------------------------------------------------
// T006 — valid SELECT returns success with correct shape
// ---------------------------------------------------------------------------
describe("AuroraDbTool — valid SELECT", () => {
  it("returns success: true with populated rows, rowCount, rowCap, scanBytesUsed, truncated: false", async () => {
    const tool = makeToolWithClient({
      query: () => Promise.resolve({ rows: [{ id: "ord-1", status: "pending" }] }),
    });

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(true);
    const data = result.data as { rows: unknown[]; rowCount: number; rowCap: number; truncated: boolean };
    expect(data.rows).toHaveLength(1);
    expect(data.rowCount).toBe(1);
    expect(data.rowCap).toBe(100);
    expect(data.truncated).toBe(false);
    expect(result.scanBytesUsed).toBe(1 * 1024);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T007 — non-SELECT queries are rejected before any pg.Client is instantiated
// ---------------------------------------------------------------------------
describe("AuroraDbTool — non-SELECT rejection", () => {
  it.each([
    ["UPDATE orders SET status = 'x' WHERE id = '1'", "UPDATE"],
    ["DELETE FROM orders WHERE id = '1'", "DELETE"],
    ["DROP TABLE orders", "DROP"],
    ["INSERT INTO orders VALUES ('x')", "INSERT"],
    ["TRUNCATE orders", "TRUNCATE"],
  ])("rejects '%s' with WRITE_REJECTED before connecting", async (query) => {
    let clientCreated = false;
    const tool = new AuroraDbTool("unused.yml", {
      catalogReader: makeCatalogReader(),
      passwordResolver: makePasswordResolver(),
      pgClientFactory: () => {
        clientCreated = true;
        return makePgClient();
      },
    });

    const result = await tool.invoke({ ...VALID_INPUT, query });

    expect(result.success).toBe(false);
    expect(result.error).toContain("WRITE_REJECTED");
    expect(clientCreated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T008 — zero-row result returns success, not an error
// ---------------------------------------------------------------------------
describe("AuroraDbTool — zero rows", () => {
  it("returns success: true with empty rows array when query matches nothing", async () => {
    const tool = makeToolWithClient({ query: () => Promise.resolve({ rows: [] }) });

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(true);
    const data = result.data as { rows: unknown[]; rowCount: number; truncated: boolean };
    expect(data.rows).toHaveLength(0);
    expect(data.rowCount).toBe(0);
    expect(data.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T009 — pg.Client.connect() throws → structured error, no propagation
// ---------------------------------------------------------------------------
describe("AuroraDbTool — connection failure", () => {
  it("returns success: false when pg.Client throws on connect", async () => {
    const tool = makeToolWithClient({
      connect: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:5432")),
    });

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// T010 — query exceeds statement_timeout → structured timeout error
// ---------------------------------------------------------------------------
describe("AuroraDbTool — query execution timeout", () => {
  it("returns success: false when pg raises query_canceled (statement timeout)", async () => {
    let callCount = 0;
    const tool = makeToolWithClient({
      query: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ rows: [] }); // SET statement_timeout
        return Promise.reject(new Error("ERROR: canceling statement due to statement timeout"));
      },
    });

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("statement timeout");
  });
});

// ---------------------------------------------------------------------------
// T011 — row cap enforcement → truncated: true
// ---------------------------------------------------------------------------
describe("AuroraDbTool — row cap", () => {
  it("truncates results when DB returns more rows than rowCap", async () => {
    const rowCap = 3;
    const rows = Array.from({ length: rowCap + 1 }, (_, i) => ({ id: `ord-${i}` }));
    const tool = makeToolWithClient(
      { query: () => Promise.resolve({ rows }) },
      { maxRows: rowCap },
    );

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(true);
    const data = result.data as { rows: unknown[]; rowCap: number; truncated: boolean };
    expect(data.rows).toHaveLength(rowCap);
    expect(data.rowCap).toBe(rowCap);
    expect(data.truncated).toBe(true);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T012 — scanBytesUsed equals rowCount * 1024
// ---------------------------------------------------------------------------
describe("AuroraDbTool — scan budget", () => {
  it("sets scanBytesUsed to rowCount * 1024", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const tool = makeToolWithClient({ query: () => Promise.resolve({ rows }) });

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.scanBytesUsed).toBe(3 * 1024);
  });
});

// ---------------------------------------------------------------------------
// T019 — multi-table JOIN returns all aliased columns (US2)
// ---------------------------------------------------------------------------
describe("AuroraDbTool — multi-table JOIN", () => {
  it("returns all aliased columns from a JOIN query", async () => {
    const joinQuery =
      "SELECT o.id AS orders_id, o.status AS orders_status, i.qty AS items_qty FROM orders o JOIN order_items i ON o.id = i.order_id WHERE o.id = 'ord-1'";
    const rows = [{ orders_id: "ord-1", orders_status: "pending", items_qty: 2 }];
    const tool = makeToolWithClient({ query: () => Promise.resolve({ rows }) });

    const result = await tool.invoke({ ...VALID_INPUT, query: joinQuery });

    expect(result.success).toBe(true);
    const data = result.data as { rows: Array<Record<string, unknown>> };
    expect(data.rows[0]).toHaveProperty("orders_id");
    expect(data.rows[0]).toHaveProperty("orders_status");
    expect(data.rows[0]).toHaveProperty("items_qty");
  });
});

// ---------------------------------------------------------------------------
// T020 — CTE is rejected (first token is WITH, not SELECT) (US2)
// ---------------------------------------------------------------------------
describe("AuroraDbGuard — CTE rejection", () => {
  it("throws WRITE_REJECTED for WITH ... SELECT (CTE)", () => {
    expect(() =>
      assertSelectOnly("WITH cte AS (SELECT id FROM orders) SELECT id FROM cte"),
    ).toThrow("WRITE_REJECTED");
    expect(() =>
      assertSelectOnly("WITH cte AS (SELECT id FROM orders) SELECT id FROM cte"),
    ).toThrow("WITH");
  });
});

// ---------------------------------------------------------------------------
// T023 — environment routing: production and staging return different hosts (US3)
// ---------------------------------------------------------------------------
describe("AuroraDbCatalogReader — environment routing", () => {
  const FIXTURE_YAML = `
services:
  - id: order-service
    auroraDatabase:
      production:
        host: prod-host.rds.amazonaws.com
        port: 5432
        database: order_service_prod
        username: iam_user
        region: eu-west-1
        credentialSource: iam
      staging:
        host: staging-host.rds.amazonaws.com
        port: 5432
        database: order_service_staging
        username: iam_user
        region: eu-west-1
        credentialSource: iam
`;

  it("returns distinct host values for production vs staging", () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-test-"));
    const path = join(dir, "catalog.yml");
    writeFileSync(path, FIXTURE_YAML);

    const reader = new AuroraDbCatalogReader(path);
    const prod = reader.resolve("order-service", "production");
    const staging = reader.resolve("order-service", "staging");

    expect(prod).not.toBeNull();
    expect(staging).not.toBeNull();
    expect(prod?.host).not.toBe(staging?.host);
    expect(prod?.host).toBe("prod-host.rds.amazonaws.com");
    expect(staging?.host).toBe("staging-host.rds.amazonaws.com");
  });
});

// ---------------------------------------------------------------------------
// T024 — missing canary entry → null → NO_DB_CONFIGURED (US3)
// ---------------------------------------------------------------------------
describe("AuroraDbTool — no catalog entry", () => {
  it("returns NO_DB_CONFIGURED when catalog has no entry for requested service/environment", async () => {
    const tool = new AuroraDbTool("unused.yml", {
      catalogReader: makeCatalogReader(null),
      passwordResolver: makePasswordResolver(),
      pgClientFactory: () => makePgClient(),
    });

    const result = await tool.invoke(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("NO_DB_CONFIGURED");
  });
});

// ---------------------------------------------------------------------------
// T025 — unknown service resolves to null (US3)
// ---------------------------------------------------------------------------
describe("AuroraDbCatalogReader — unknown service", () => {
  it("returns null for an unknown service ID", () => {
    const reader = new AuroraDbCatalogReader("service-catalog.yml");
    const result = reader.resolve("nonexistent-service", "production");
    expect(result).toBeNull();
  });
});
