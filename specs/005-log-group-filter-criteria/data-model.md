# Data Model: Log Group Filter Criteria

**Branch**: `005-log-group-filter-criteria` | **Date**: 2026-05-05

---

## Entities

### LogGroupFilter

A single filter expression that resolves to zero or more CloudWatch log group names in a given AWS account.

| Field   | Type                       | Required | Description |
|---------|----------------------------|----------|-------------|
| `type`  | `"prefix" \| "pattern"`    | Yes      | `prefix`: matches groups whose name starts with `value`. `pattern`: matches groups whose name contains `value` as a substring. |
| `value` | `string` (non-empty)       | Yes      | The string to match against. |

**Validation**:
- `value` MUST NOT be empty.
- `type` MUST be one of the two enum values; any other value is a catalog load error.

**Mapping to AWS API**:
- `prefix` → `DescribeLogGroupsCommand({ logGroupNamePrefix: value })`
- `pattern` → `DescribeLogGroupsCommand({ logGroupNamePattern: value })`

---

### ServiceEntry (updated)

Extends the existing `ServiceEntry` in `ServiceCatalogTool.ts`.

| Field             | Type                                    | Required | Notes |
|-------------------|-----------------------------------------|----------|-------|
| `id`              | `string`                                | Yes      | Unchanged |
| `displayName`     | `string`                                | Yes      | Unchanged |
| `environments`    | `string[]`                              | Yes      | Unchanged |
| `logGroups`       | `Record<string, string>`                | No       | Legacy; used when `logGroupFilters` absent |
| `logGroupFilters` | `Record<string, LogGroupFilter[]>`      | No       | New; keyed by environment name; takes precedence over `logGroups` when present |
| `maxLogGroups`    | `number` (default 50)                   | No       | Per-service discovery cap override |
| `ecsCluster`      | `string`                                | Yes      | Unchanged |
| `linkingKeySchema`| `Record<string, string>`                | Yes      | Unchanged |
| `observationTypes`| `string[]`                              | No       | Unchanged |

**Precedence rule**: If `logGroupFilters[environment]` is present and non-empty, it is used. Otherwise, `logGroups[environment]` is synthesised into a single `prefix` filter. If neither is present for the requested environment, the tool returns an error.

**YAML example (new format)**:
```yaml
- id: booking-service
  logGroupFilters:
    prod:
      - type: prefix
        value: /ecs/booking-service/prod
      - type: pattern
        value: booking-service
    dev:
      - type: prefix
        value: /ecs/booking-service/dev
  maxLogGroups: 30
```

**YAML example (legacy format — unchanged, backward-compatible)**:
```yaml
- id: order-service
  logGroups:
    prod: /ecs/order-service/prod
    dev: /ecs/order-service/dev
```

---

### ServiceLookupResult (updated)

The return value of `ServiceCatalogTool.invoke()` and `.resolve()`.

| Field              | Type                   | Notes |
|--------------------|------------------------|-------|
| `serviceId`        | `string`               | Unchanged |
| `displayName`      | `string`               | Unchanged |
| `environment`      | `string`               | Unchanged |
| `logGroup`         | `string`               | **Kept for backward compat** — set to the first resolved filter's `value` or the legacy field |
| `logGroupFilters`  | `LogGroupFilter[]`     | **New** — the ordered list of filter expressions for the requested environment |
| `maxLogGroups`     | `number`               | **New** — discovery cap (defaults to 50) |
| `ecsCluster`       | `string`               | Unchanged |
| `linkingKeySchema` | `Record<string, LinkingKeyType>` | Unchanged |

---

### DiscoveredLogGroups

The return value of `LogGroupDiscoveryTool.invoke()`.

| Field          | Type                         | Description |
|----------------|------------------------------|-------------|
| `groups`       | `DiscoveredGroup[]`          | De-duplicated, ordered list of matching log group names |
| `capped`       | `boolean`                    | `true` if the discovery cap was reached before exhausting all matches |
| `totalFound`   | `number`                     | Total matched before capping |

### DiscoveredGroup

| Field         | Type                              | Description |
|---------------|-----------------------------------|-------------|
| `name`        | `string`                          | Full CloudWatch log group name |
| `filter`      | `LogGroupFilter`                  | The filter expression that produced this match |

---

## Relationships

```
ServiceEntry
  └── logGroupFilters: Record<env, LogGroupFilter[]>
        └── LogGroupFilter  ──[resolved by]──▶  DiscoveredGroup[]
                                                    └── name: string
                                                           └──[queried by]──▶ CloudWatchLogsTool
```

## State Transitions

`LogGroupFilter` → `DiscoveredGroup[]` occurs once per investigation at startup. Results are passed as tool input; they are not persisted between investigations.
