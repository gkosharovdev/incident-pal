# Quickstart: Aurora PostgreSQL DB Query Tool

**Branch**: `002-aurora-db-query-tool` | **Date**: 2026-05-01

---

## 1. Add dependencies

```bash
npm install pg @aws-sdk/rds-signer
npm install --save-dev @types/pg
```

---

## 2. Extend the service catalog

Add an `auroraDatabase` section to each service entry in `service-catalog.yml` that has a PostgreSQL database:

```yaml
services:
  - id: order-service
    # ... existing fields unchanged ...
    auroraDatabase:
      production:
        host: order-service.cluster-abc123.eu-west-1.rds.amazonaws.com
        port: 5432
        database: order_service_prod
        username: iam_investigation_user
        region: eu-west-1
        credentialSource: iam
      staging:
        host: order-service-staging.cluster-def456.eu-west-1.rds.amazonaws.com
        port: 5432
        database: order_service_staging
        username: iam_investigation_user
        region: eu-west-1
        credentialSource: iam
```

For services without IAM auth, use `credentialSource: env-var` and set `envPasswordVar` to the name of the environment variable holding the password:

```yaml
        credentialSource: env-var
        envPasswordVar: ORDER_SERVICE_DB_PASSWORD_STAGING
```

---

## 3. IAM prerequisites

For `credentialSource: iam`, the process's IAM role must have this permission:

```json
{
  "Effect": "Allow",
  "Action": "rds-db:connect",
  "Resource": "arn:aws:rds-db:eu-west-1:123456789:dbuser:cluster-abc123/iam_investigation_user"
}
```

The Aurora cluster must have IAM authentication enabled (cluster parameter `aws_auth_set` or console toggle).

---

## 4. Register the tool

```typescript
import { AuroraDbTool } from "incident-pal/tools/extensions/aurora-db";

const agent = new InvestigationAgent({
  tools: [
    new CloudWatchLogsTool(cwClient),
    new EcsDeploymentTool(ecsClient),
    new ServiceCatalogTool("./service-catalog.yml"),
    new CustomerCorrelationTool(httpClient, correlationBaseUrl),
    new AuroraDbTool("./service-catalog.yml"),  // <-- add this
  ],
});
```

Optional constructor overrides:

```typescript
new AuroraDbTool("./service-catalog.yml", {
  maxRows: 200,          // default: 100
  queryTimeoutMs: 5000,  // default: 10000
});
```

---

## 5. How the agent uses the tool

The agent calls `aurora-db` with three fields:

| Field | Example |
|---|---|
| `serviceId` | `"order-service"` |
| `environment` | `"production"` |
| `query` | `"SELECT id, status, updated_at FROM orders WHERE id = 'ord-9876' LIMIT 1"` |

The tool returns an array of row objects:

```json
{
  "rows": [
    { "id": "ord-9876", "status": "pending", "updated_at": "2026-05-01T09:12:34.000Z" }
  ],
  "rowCount": 1,
  "truncated": false,
  "queryExecutedMs": 42,
  "serviceId": "order-service",
  "environment": "production"
}
```

---

## 6. What happens when no database is configured

If `service-catalog.yml` has no `auroraDatabase` entry for the requested service/environment, the tool returns:

```json
{
  "success": false,
  "data": null,
  "error": "NO_DB_CONFIGURED: No Aurora database configured for 'order-service' in 'canary'"
}
```

The agent records this as a `tool-error` trace entry and continues the investigation.
