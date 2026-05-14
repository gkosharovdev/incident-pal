# Research: AWS Agent Toolkit Retrofit

**Branch**: `006-aws-agent-toolkit-retrofit` | **Date**: 2026-05-12

---

## Decision 1: How incident-pal connects to the AWS Agent Toolkit

**Decision**: incident-pal acts as a TypeScript MCP client using `@modelcontextprotocol/sdk`. It spawns the `mcp-proxy-for-aws` process locally via Node.js `child_process` and communicates over stdio using JSON-RPC as defined by the MCP protocol.

**Rationale**: The AWS Agent Toolkit is an MCP server — not a library. The only supported integration path is MCP. The Model Context Protocol TypeScript SDK provides a battle-tested client implementation that handles connection lifecycle, message framing, and error recovery. Spawning the proxy locally over stdio avoids HTTP networking and firewall concerns.

**Alternatives considered**:
- Direct HTTP to the AWS-hosted MCP endpoint (rejected: adds network dependency, requires manual SigV4 signing, bypasses the proxy's credential-renewal logic)
- Vendoring the proxy logic in TypeScript (rejected: reimplements what the proxy already does; would need maintenance as the AWS toolkit evolves)

---

## Decision 2: MCP client lifecycle

**Decision**: One `AwsToolkitClient` instance is created per `InvestigationAgent` instance, established at agent construction time, and shared across all tool adapters in every investigation. The connection is closed when the agent is disposed.

**Rationale**: The MCP proxy initialization takes a few seconds on first connection. Creating a new connection per investigation would add unacceptable latency. A shared, persistent client matches the existing pattern where AWS SDK clients are created once and injected into tools. All tool adapters receive the same `AwsToolkitClient` reference at construction time.

**Alternatives considered**:
- Per-investigation client (rejected: proxy startup latency; also risks credential expiry races during multi-investigation runs)
- Per-tool-call connection (rejected: excessive overhead; connections are not lightweight)

---

## Decision 3: Scan budget tracking with toolkit-mediated calls

**Decision**: Scan byte estimation is preserved by calling `aws___call_aws` with `DescribeLogGroups` before running each log query. The `storedBytes` field returned by AWS is used as the byte estimate, identical to the current implementation. The `ToolResult.scanBytesUsed` field is populated from this value.

**Rationale**: The `ScanBudget` enforcement in `InvestigationAgent` depends on `scanBytesUsed` in the `ToolResult`. Removing this would break a core safety mechanism. Since `DescribeLogGroups` is available via `aws___call_aws`, the same estimation approach works regardless of whether the underlying call uses the SDK or the toolkit.

**Alternatives considered**:
- Estimating bytes from response payload size (rejected: underestimates actual scan cost; breaks ScanBudget contract)
- Disabling scan budget for toolkit-mediated calls (rejected: violates constitution §I safety enforcement)

---

## Decision 4: Aurora DB — out of scope for this feature; credential path documented

**Decision**: `AuroraDbTool` is not part of this retrofit. It already makes direct PostgreSQL connections via the `pg` client — that connection model is database-agnostic and needs no change. The only AWS-specific code is `@aws-sdk/rds-signer` for IAM token generation. If that dependency is ever removed, the clean replacement is a Secrets Manager lookup: a single `aws___call_aws("secretsmanager", "GetSecretValue", { SecretId: "..." })` call returns the database password as plain text with no Python scripting required. This would be a separate, self-contained credential-provider task, not part of this feature.

**Rationale**: Secrets Manager retrieval is a standard API call, not a scripted workflow. It requires no ephemeral containers, no Python, and no `aws___run_script`. The `pg` connection and all query logic stay exactly as they are.

---

## Decision 5: TypeScript MCP client dependency

**Decision**: Add `@modelcontextprotocol/sdk` to `dependencies`. This is the official MCP TypeScript SDK maintained by Anthropic. It provides `StdioClientTransport` and `Client` classes that handle all low-level MCP protocol details.

**Rationale**: The `@modelcontextprotocol/sdk` is the only production-ready TypeScript MCP client. It is maintained by Anthropic, widely used, and has strong TypeScript support. Implementing MCP protocol parsing from scratch would be substantial complexity for no benefit.

**Alternatives considered**:
- Implementing JSON-RPC over stdio manually (rejected: reimplements the MCP framing layer with high error risk)
- Using the Anthropic SDK's built-in MCP support (rejected: Anthropic SDK manages server-side tool definitions, not client-side MCP connections)

---

## Decision 6: Tool naming and replacement strategy

**Decision**: New toolkit-backed adapters replace the existing tool classes in-place (same file paths, same tool `name` strings). Existing tools are moved to `*Legacy.ts` alongside the new implementations during the migration task, then deleted after all quality gates pass.

**Rationale**: The `name` string on each tool is what the LLM calls — changing it would require prompt changes and eval fixture updates. Keeping identical names ensures the existing golden-set evals and trace assertions continue to pass without modification.

**Alternatives considered**:
- Parallel deployment with feature flag (rejected: no feature flag infrastructure exists; adds complexity for a one-time migration)
- New tool names alongside originals (rejected: requires prompt updates and eval fixture changes; LLM would need to choose between two identically-described tools)

---

## Decision 7: Proxy delivery method

**Decision**: Run the MCP proxy as a Docker container using the official public ECR image (`public.ecr.aws/mcp-proxy-for-aws/mcp-proxy-for-aws:latest`). The `AwsToolkitClient` connects to the proxy over HTTP (stdio transport is used when running `uvx` locally; HTTP/SSE transport is used when the proxy runs as a sidecar container). This eliminates any Python toolchain dependency from the deployment environment.

**Rationale**: incident-pal already runs in a containerised environment. A Docker sidecar is a natural fit and requires no changes to the host's package ecosystem. The Docker image is published by AWS to public ECR and versioned — `public.ecr.aws/mcp-proxy-for-aws/mcp-proxy-for-aws:1.1.6` for pinning, or `latest` for rolling updates. This is a cleaner boundary than requiring `uv`/`uvx` installed on the host.

**Alternatives considered**:
- `uvx mcp-proxy-for-aws@latest` over stdio (valid for local development; `uv` becomes a dev-only prerequisite rather than a production one)
- `pip install mcp-proxy-for-aws` (same Python ecosystem concern as `uvx`; no advantage over Docker in a container runtime)
- No npm / pre-compiled binary distribution exists

## Decision 8: `aws___run_script` is prohibited in incident-pal

**Decision**: `aws___run_script` is not used by this feature or any future tool in incident-pal. The agent interacts with AWS exclusively through concrete, typed `Tool` implementations backed by `aws___call_aws`. The agent never writes scripts, spins up ephemeral containers, or executes code in remote sandboxes as part of an investigation.

**Rationale**: Tools in incident-pal are narrow, typed adapters. Their descriptions tell the agent exactly what data they return and when to call them. This model is predictable, testable, and auditable. `aws___run_script` inverts that model: it would require the agent to author Python code at runtime, producing behaviour that cannot be unit-tested in advance, that bypasses the `Tool` interface contract, and that introduces a Python runtime dependency with no TypeScript type safety. Every AWS operation incident-pal needs can be expressed as a direct `aws___call_aws` invocation — there is no case where scripting is required.

**Alternatives considered**:
- `aws___run_script` for multi-step or parallel API workflows (rejected: `AwsToolkitClient.callAws()` can be called multiple times in sequence within a tool's `invoke()` method; orchestration belongs in TypeScript, not in an ephemeral Python sandbox)
