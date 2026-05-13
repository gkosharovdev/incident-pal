import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AwsToolkitClient, AwsToolkitError } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";

const TOOL_CALL_RESULT = JSON.stringify({ QueryId: "q-integration-1" });

function startMockMcpSseServer(opts: {
  respondWithError?: boolean;
}): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const connections: ServerResponse[] = [];

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "GET" && req.url === "/sse") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        connections.push(res);
        // Send endpoint event as MCP SSE protocol requires
        res.write(`event: endpoint\ndata: /messages\n\n`);
        req.on("close", () => {
          const idx = connections.indexOf(res);
          if (idx !== -1) connections.splice(idx, 1);
        });
        return;
      }

      if (req.method === "POST" && req.url === "/messages") {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          let parsed: { id?: string | number; method?: string } = {};
          try { parsed = JSON.parse(body) as typeof parsed; } catch { /* ignore */ }

          if (parsed.method === "initialize") {
            const response = JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: {
                protocolVersion: "2024-11-05",
                serverInfo: { name: "mock-mcp", version: "1.0.0" },
                capabilities: { tools: {} },
              },
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(response);
            // Emit SSE notification
            for (const conn of connections) {
              conn.write(`event: message\ndata: ${response}\n\n`);
            }
            return;
          }

          if (parsed.method === "tools/call") {
            const content = opts.respondWithError
              ? [{ type: "text", text: "AccessDeniedException" }]
              : [{ type: "text", text: TOOL_CALL_RESULT }];
            const response = JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { content, isError: opts.respondWithError ?? false },
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(response);
            for (const conn of connections) {
              conn.write(`event: message\ndata: ${response}\n\n`);
            }
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/sse`,
        close: () =>
          new Promise((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

describe("AwsToolkitClient integration", () => {
  let server: { url: string; close: () => Promise<void> } | null = null;
  let client: AwsToolkitClient | null = null;

  afterEach(async () => {
    await client?.dispose();
    await server?.close();
    client = null;
    server = null;
  });

  it("connects to mock SSE server, calls aws___call_aws, and returns parsed body", async () => {
    server = await startMockMcpSseServer({});
    client = new AwsToolkitClient(server.url);
    await client.connect();

    const result = await client.callAws<{ QueryId: string }>(
      "cloudwatch-logs",
      "StartQuery",
      { logGroupName: "/ecs/svc", queryString: "fields @message", startTime: 0, endTime: 1 },
    );

    expect(result.body.QueryId).toBe("q-integration-1");
  });

  it("throws AwsToolkitError when the mock server returns isError: true", async () => {
    server = await startMockMcpSseServer({ respondWithError: true });
    client = new AwsToolkitClient(server.url);
    await client.connect();

    await expect(
      client.callAws("cloudwatch-logs", "StartQuery", {}),
    ).rejects.toThrow(AwsToolkitError);
  });

  it("dispose closes connection cleanly and allows re-dispose", async () => {
    server = await startMockMcpSseServer({});
    client = new AwsToolkitClient(server.url);
    await client.connect();
    await client.dispose();
    await client.dispose(); // no-op, no throw
  });
});
