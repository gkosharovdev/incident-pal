# Data Model: AWS Agent Toolkit Retrofit

**Branch**: `006-aws-agent-toolkit-retrofit` | **Date**: 2026-05-12

---

## New entities

### AwsToolkitClient

Manages the MCP connection to the AWS Agent Toolkit proxy. Created once per `InvestigationAgent` instance. All tool adapters share the same client instance.

**Fields**:
- `mcpClient` — the `@modelcontextprotocol/sdk` `Client` instance connected to the Docker sidecar proxy over HTTP/SSE

**Key methods**:
- `connect(): Promise<void>` — establishes the MCP connection to the running proxy; called once at construction
- `callAws<T>(service: string, operation: string, params: Record<string, unknown>): Promise<AwsApiCallResult<T>>` — invokes `aws___call_aws`; returns parsed response body
- `dispose(): Promise<void>` — closes the MCP connection

**Relationships**: Injected into each toolkit-backed tool adapter at construction time.

---

### AwsApiCallResult\<T\>

The parsed response returned by a single `aws___call_aws` invocation.

**Fields**:
- `body: T` — the deserialized AWS API response payload, typed by the caller
- `requestId: string` — the AWS request ID from the response headers (for audit)
- `httpStatus: number` — the HTTP status code from the underlying AWS API call

---

## Unchanged entities

The following types are **not modified** by this feature. They are listed here for reference because the new tool adapters produce and consume them.

### ToolResult (unchanged)

```typescript
interface ToolResult {
  success: boolean;
  data: unknown;
  error: string | null;
  scanBytesUsed?: number;
  truncated?: boolean;
}
```

All toolkit-backed adapters produce `ToolResult` values with the same shape as today. The `scanBytesUsed` field is still populated for CloudWatch tools.

### Tool interface (unchanged)

```typescript
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema7;
  invoke(input: unknown): Promise<ToolResult>;
}
```

All three replacement adapters implement this interface. No change to the interface itself.

---

## Tool adapter → AWS toolkit mapping

| Existing tool class | New adapter class | `aws___call_aws` operations used |
|---------------------|-------------------|----------------------------------|
| `CloudWatchLogsTool` | `CloudWatchLogsToolV2` | `cloudwatch-logs:StartQuery`, `cloudwatch-logs:GetQueryResults`, `cloudwatch-logs:DescribeLogGroups` |
| `LogGroupDiscoveryTool` | `LogGroupDiscoveryToolV2` | `cloudwatch-logs:DescribeLogGroups` |
| `EcsDeploymentTool` | `EcsDeploymentToolV2` | `ecs:DescribeServices` |

---

## Removed dependencies (after migration completes)

| Package | Replaced by |
|---------|-------------|
| `@aws-sdk/client-cloudwatch-logs` | `aws___call_aws` via `AwsToolkitClient` |
| `@aws-sdk/client-ecs` | `aws___call_aws` via `AwsToolkitClient` |

**Added dependency**: `@modelcontextprotocol/sdk` (production)
**Added runtime prerequisite** (not npm): Docker sidecar running `public.ecr.aws/mcp-proxy-for-aws/mcp-proxy-for-aws:latest`
