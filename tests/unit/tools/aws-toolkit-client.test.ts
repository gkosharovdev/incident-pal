import { describe, it, expect, vi, beforeEach } from "vitest";
import { AwsToolkitClient, AwsToolkitError } from "../../../src/tools/aws-toolkit/AwsToolkitClient.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

function makeMockClient(overrides: {
  callTool?: (req: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  close?: () => Promise<void>;
}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(
      overrides.callTool ?? (() => Promise.resolve({ content: [], isError: false })),
    ),
    close: vi.fn().mockImplementation(overrides.close ?? (() => Promise.resolve())),
  };
}

describe("AwsToolkitClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connect constructs SSEClientTransport with the given proxyUrl and calls client.connect", async () => {
    const mockClient = makeMockClient({});
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation(
      (url) => ({ url }) as unknown as SSEClientTransport,
    );

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await client.connect();

    expect(SSEClientTransport).toHaveBeenCalledWith(new URL("http://mcp-proxy:8080/sse"));
    expect(mockClient.connect).toHaveBeenCalledOnce();
  });

  it("callAws serialises service, operation, and params into aws___call_aws tool call", async () => {
    const mockClient = makeMockClient({
      callTool: () =>
        Promise.resolve({
          isError: false,
          content: [{ type: "text", text: JSON.stringify({ QueryId: "q-1" }) }],
        }),
    });
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation((url) => ({ url }) as unknown as SSEClientTransport);

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await client.connect();
    const result = await client.callAws<{ QueryId: string }>("cloudwatch-logs", "StartQuery", {
      logGroupName: "/ecs/svc",
      queryString: "fields @message",
      startTime: 0,
      endTime: 1,
    });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: "aws___call_aws",
      arguments: {
        service: "cloudwatch-logs",
        operation: "StartQuery",
        params: {
          logGroupName: "/ecs/svc",
          queryString: "fields @message",
          startTime: 0,
          endTime: 1,
        },
      },
    });
    expect(result.body.QueryId).toBe("q-1");
  });

  it("callAws throws AwsToolkitError when isError is true", async () => {
    const mockClient = makeMockClient({
      callTool: () =>
        Promise.resolve({
          isError: true,
          content: [{ type: "text", text: "AccessDeniedException: not authorized" }],
        }),
    });
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation((url) => ({ url }) as unknown as SSEClientTransport);

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await client.connect();

    await expect(client.callAws("ecs", "DescribeServices", {})).rejects.toThrow(AwsToolkitError);
    await expect(client.callAws("ecs", "DescribeServices", {})).rejects.toThrow(
      "AccessDeniedException",
    );
  });

  it("callAws throws AwsToolkitError when response has no text content", async () => {
    const mockClient = makeMockClient({
      callTool: () => Promise.resolve({ isError: false, content: [] }),
    });
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation((url) => ({ url }) as unknown as SSEClientTransport);

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await client.connect();

    await expect(client.callAws("ecs", "DescribeServices", {})).rejects.toThrow(
      "returned no text content",
    );
  });

  it("callAws throws AwsToolkitError when response text is not valid JSON", async () => {
    const mockClient = makeMockClient({
      callTool: () =>
        Promise.resolve({ isError: false, content: [{ type: "text", text: "not-json" }] }),
    });
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation((url) => ({ url }) as unknown as SSEClientTransport);

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await client.connect();

    await expect(client.callAws("ecs", "DescribeServices", {})).rejects.toThrow(
      "non-JSON response",
    );
  });

  it("callAws throws AwsToolkitError when called before connect", async () => {
    vi.mocked(Client).mockImplementation(() => makeMockClient({}) as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation((url) => ({ url }) as unknown as SSEClientTransport);

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await expect(client.callAws("ecs", "DescribeServices", {})).rejects.toThrow(
      "not connected",
    );
  });

  it("dispose calls client.close and allows re-dispose without error", async () => {
    const mockClient = makeMockClient({});
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client);
    vi.mocked(SSEClientTransport).mockImplementation((url) => ({ url }) as unknown as SSEClientTransport);

    const client = new AwsToolkitClient("http://mcp-proxy:8080/sse");
    await client.connect();
    await client.dispose();
    await client.dispose(); // second dispose is a no-op

    expect(mockClient.close).toHaveBeenCalledOnce();
  });
});
