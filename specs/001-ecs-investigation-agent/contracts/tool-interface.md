# Contract: Tool Interface

**Type**: Internal extension contract  
**Version**: 1.0.0  
**Date**: 2026-04-30

All tools — built-in and registered extensions — must implement this interface. The agent core depends only on this abstraction (Dependency Inversion, constitution clause III).

---

## TypeScript Interface

```typescript
interface Tool {
  /**
   * Unique identifier for this tool.
   * Used in trace entries, report evidence attribution, and LLM tool definitions.
   * Must be stable across versions — changing it is a breaking change.
   */
  readonly name: string;

  /**
   * Human-readable description shown to the LLM.
   * Should clearly explain what the tool does and what information it returns.
   * Must NOT imply any write capability.
   */
  readonly description: string;

  /**
   * JSON Schema for the tool's input object.
   * The agent validates inputs against this schema before calling invoke().
   */
  readonly inputSchema: JSONSchema7;

  /**
   * Execute a read-only query and return structured results.
   *
   * Contract:
   * - MUST be read-only. Any write, delete, or state-changing operation is a constitution violation.
   * - MUST be idempotent — calling invoke() multiple times with the same input produces equivalent results.
   * - MUST NOT throw. All errors must be returned as ToolResult { success: false, error: "..." }.
   * - SHOULD complete within 30 seconds. Long-running queries must be bounded internally.
   */
  invoke(input: unknown): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  data: unknown | null;       // Structured output on success; null on failure
  error: string | null;       // Human-readable error message; null on success
  scanBytesUsed?: number;     // For log query tools: bytes scanned
  truncated?: boolean;        // true if result-count threshold was hit
}
```

---

## Tool Registration

Tools are registered in the `ToolRegistry` at agent construction time:

```typescript
const agent = new InvestigationAgent({
  tools: [
    new CloudWatchLogsTool(cloudWatchClient, config),
    new EcsDeploymentTool(ecsClient),
    new NotificationOutboxTool(outboxClient),
    new EmailDeliveryStatusTool(emailClient),
    new ServiceCatalogTool(catalogConfig),
    new CustomerCorrelationTool(correlationClient),
    // Register additional tools here — no core changes needed
  ],
});
```

---

## Built-in Tools

| Tool Name | Data Source | Key Inputs |
|---|---|---|
| `cloudwatch-logs` | AWS CloudWatch Logs Insights | log group, query expression, time window |
| `ecs-deployment` | AWS ECS | service name, environment, time window |
| `notification-outbox` | Notification outbox store | linking keys, time window |
| `email-delivery-status` | Email delivery provider | recipient or message ID, time window |
| `service-catalog` | Service registry | service name |
| `customer-correlation` | Customer/entity lookup | entity type, entity ID |

---

## Extension Requirements

Every new tool registered in the `ToolRegistry` MUST (constitution clause VI):

1. Implement the `Tool` interface above.
2. Have a unit test covering its `invoke()` logic with mocked responses.
3. Have an integration test (or recorded fixture) covering response parsing.
4. Have at least one eval fixture for an investigation scenario that uses it.
5. Be read-only — any write operation is an automatic CI gate failure.
