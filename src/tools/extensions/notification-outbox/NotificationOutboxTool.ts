/**
 * NotificationOutboxTool — reference extension implementation.
 *
 * This tool is intentionally placed in src/tools/extensions/ rather than src/tools/ to
 * demonstrate that domain-specific tools are registered at runtime, not hardcoded in the core.
 *
 * Teams building payment, status, or other domain-specific tools should follow this pattern:
 * 1. Implement the Tool interface (src/models/Tool.ts).
 * 2. Add unit + integration tests.
 * 3. Register via InvestigationAgent({ tools: [..., new YourTool(client)] }).
 * No changes to core agent code are needed.
 */
import type { Tool, ToolResult } from "../../../models/Tool.js";
import type { JSONSchema7 } from "../../../models/JSONSchema.js";

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    linkingKey: {
      type: "string",
      description: "Customer ID, notification ID, or order ID to look up in the outbox",
    },
    linkingKeyType: {
      type: "string",
      enum: ["customer-id", "notification-id", "order-id"],
      description: "Type of linking key provided",
    },
    from: { type: "string", description: "ISO 8601 start of time window" },
    to: { type: "string", description: "ISO 8601 end of time window" },
  },
  required: ["linkingKey", "linkingKeyType", "from", "to"],
  additionalProperties: false,
};

interface OutboxInput {
  linkingKey: string;
  linkingKeyType: string;
  from: string;
  to: string;
}

interface OutboxRecord {
  notificationId: string;
  customerId: string;
  type: string;
  status: "queued" | "dispatched" | "failed" | "expired";
  queuedAt: string;
  dispatchedAt: string | null;
  failureReason: string | null;
  retryCount: number;
}

interface HttpClient {
  get(url: string, params: Record<string, string>): Promise<unknown>;
}

export class NotificationOutboxTool implements Tool {
  readonly name = "notification-outbox";
  readonly description =
    "Query the notification outbox for messages related to a customer, notification, or order within a time window. Returns outbox records showing queued, dispatched, failed, or expired notifications.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: HttpClient;
  private readonly baseUrl: string;

  constructor(client: HttpClient, baseUrl: string) {
    this.client = client;
    this.baseUrl = baseUrl;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const params = input as OutboxInput;

    try {
      const data = await this.client.get(`${this.baseUrl}/outbox/query`, {
        linkingKey: params.linkingKey,
        linkingKeyType: params.linkingKeyType,
        from: params.from,
        to: params.to,
      });

      const records = data as OutboxRecord[];
      return { success: true, data: records, error: null };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: `NotificationOutbox query failed: ${String(err)}`,
      };
    }
  }
}
