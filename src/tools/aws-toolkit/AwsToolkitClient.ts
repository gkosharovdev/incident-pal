import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export class AwsToolkitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsToolkitError";
  }
}

export interface AwsApiCallResult<T> {
  body: T;
}

const CLIENT_INFO = { name: "incident-pal", version: "1.0.0" } as const;

export class AwsToolkitClient {
  private readonly proxyUrl: string;
  private client: Client | null = null;

  constructor(proxyUrl: string) {
    this.proxyUrl = proxyUrl;
  }

  async connect(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- AWS MCP proxy uses the SSE transport protocol
    const transport = new SSEClientTransport(new URL(this.proxyUrl));
    this.client = new Client(CLIENT_INFO, { capabilities: {} });
    await this.client.connect(transport);
  }

  async callAws<T>(
    service: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<AwsApiCallResult<T>> {
    if (!this.client) {
      throw new AwsToolkitError("AwsToolkitClient not connected. Call connect() first.");
    }
    const result = await this.client.callTool({
      name: "aws___call_aws",
      arguments: { service, operation, params },
    });

    type ContentBlock = { type: string; text?: string };
    const content = result.content as ContentBlock[];

    if (result.isError === true) {
      const message = content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      throw new AwsToolkitError(`aws___call_aws failed: ${message}`);
    }

    const textContent = content.find(
      (c): c is { type: "text"; text: string } => c.type === "text",
    );
    if (!textContent) {
      throw new AwsToolkitError("aws___call_aws returned no text content");
    }

    try {
      const body = JSON.parse(textContent.text) as T;
      return { body };
    } catch {
      throw new AwsToolkitError(
        `aws___call_aws returned non-JSON response: ${textContent.text}`,
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
