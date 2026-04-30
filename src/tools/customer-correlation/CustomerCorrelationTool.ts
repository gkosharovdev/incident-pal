import type { Tool, ToolResult } from "../../models/Tool.js";
import type { JSONSchema7 } from "../../models/JSONSchema.js";

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    entityType: {
      type: "string",
      description: "Type of entity (e.g., order, customer, payment)",
    },
    entityId: { type: "string", description: "Entity identifier" },
  },
  required: ["entityType", "entityId"],
  additionalProperties: false,
};

interface CorrelationInput {
  entityType: string;
  entityId: string;
}

interface HttpClient {
  get(url: string): Promise<unknown>;
}

export class CustomerCorrelationTool implements Tool {
  readonly name = "customer-correlation";
  readonly description =
    "Resolve an entity (order, customer, payment) to its associated metadata and related entity IDs. Returns customer-level context including related orders, service subscriptions, and relevant linking keys.";
  readonly inputSchema = INPUT_SCHEMA;

  private readonly client: HttpClient;
  private readonly baseUrl: string;

  constructor(client: HttpClient, baseUrl: string) {
    this.client = client;
    this.baseUrl = baseUrl;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const params = input as CorrelationInput;

    try {
      const data = await this.client.get(
        `${this.baseUrl}/entities/${encodeURIComponent(params.entityType)}/${encodeURIComponent(params.entityId)}`,
      );
      return { success: true, data, error: null };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: `CustomerCorrelation lookup failed: ${String(err)}`,
      };
    }
  }
}
