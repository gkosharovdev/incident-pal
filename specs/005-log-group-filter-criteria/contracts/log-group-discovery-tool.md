# Contract: LogGroupDiscoveryTool

**Tool name**: `log-group-discovery`
**File**: `src/tools/cloudwatch/LogGroupDiscoveryTool.ts`

---

## Input Schema

```typescript
interface LogGroupDiscoveryInput {
  filters: Array<{
    type: "prefix" | "pattern";
    value: string;
  }>;
  maxGroups?: number;  // default 50; capped at 50
}
```

JSON Schema:
```json
{
  "type": "object",
  "properties": {
    "filters": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type":  { "type": "string", "enum": ["prefix", "pattern"] },
          "value": { "type": "string", "minLength": 1 }
        },
        "required": ["type", "value"],
        "additionalProperties": false
      },
      "minItems": 1
    },
    "maxGroups": { "type": "number" }
  },
  "required": ["filters"],
  "additionalProperties": false
}
```

---

## Output

**Success** (`result.success === true`):

```typescript
interface DiscoverySuccess {
  groups: Array<{
    name: string;           // full CloudWatch log group name
    filter: {
      type: "prefix" | "pattern";
      value: string;
    };
  }>;
  capped: boolean;          // true if maxGroups limit was hit
  totalFound: number;       // count before deduplication + cap
}
```

**Failure** (`result.success === false`):

```typescript
interface DiscoveryFailure {
  error: string;  // e.g. "DescribeLogGroups failed: AccessDeniedException..."
}
```

---

## Behaviour Guarantees

1. **De-duplication**: If two filters match the same log group name, that name appears exactly once in `groups`, attributed to the first filter that matched it.
2. **Ordering**: Groups are returned in the order they were discovered (filter order, then lexicographic within each filter's page results).
3. **Cap**: No more than `maxGroups` (default 50, hard ceiling 50) groups are returned. If the cap is hit, `capped: true` is set.
4. **Empty match**: If no log groups match any filter, `groups` is an empty array, `capped` is `false`, and `success` is `true`. An empty result is not an error.
5. **Partial failure**: If one filter's DescribeLogGroups call fails, the tool returns `success: false` with the AWS error message. It does not partially return results from successful filters (fail-fast to avoid misleading partial scope).
6. **Read-only**: Makes only `DescribeLogGroups` API calls. No writes.

---

## Agent Usage Pattern

```
1. Call service-catalog(serviceId, environment)
   → receives logGroupFilters: [{type, value}, ...]

2. Call log-group-discovery(filters: logGroupFilters)
   → receives groups: [{name, filter}, ...], capped

3. For each group.name:
     Call cloudwatch-logs(logGroup: group.name, queryExpression, from, to)
```

---

## Contract: ServiceCatalogTool (updated output)

**Tool name**: `service-catalog`
**File**: `src/tools/service-catalog/ServiceCatalogTool.ts`

The existing output shape gains two new optional fields:

```typescript
// Added to ServiceLookupResult:
logGroupFilters: Array<{ type: "prefix" | "pattern"; value: string }>;
maxLogGroups: number;
```

`logGroup` (existing field) is retained unchanged. `logGroupFilters` always contains at least one entry (synthesised from `logGroup` if no explicit filters are configured). Agents SHOULD use `logGroupFilters` for discovery and fall back to `logGroup` only when `log-group-discovery` is unavailable.
