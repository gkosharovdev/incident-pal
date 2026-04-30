import type { LinkingKey, LinkingKeyType } from "../models/LinkingKey.js";

export type LinkingKeySchema = Record<string, LinkingKeyType>;

export class LinkingKeyExtractor {
  extract(
    logEntry: unknown,
    schema: LinkingKeySchema,
    defaultEntityType: string,
  ): LinkingKey[] {
    if (!logEntry || typeof logEntry !== "object") return [];

    const entry = logEntry as Record<string, unknown>;
    const keys: LinkingKey[] = [];

    for (const [fieldName, keyType] of Object.entries(schema)) {
      const fieldValue = entry[fieldName];
      if (typeof fieldValue !== "string" || fieldValue.length === 0) continue;

      if (keyType === "entity-id") {
        keys.push({ type: "entity-id", entityType: defaultEntityType, value: fieldValue });
      } else if (keyType === "http-correlation") {
        keys.push({ type: "http-correlation", value: fieldValue });
      } else {
        keys.push({ type: "kafka-message-id", value: fieldValue });
      }
    }

    return keys;
  }

  extractFromEntries(
    entries: unknown[],
    schema: LinkingKeySchema,
    defaultEntityType: string,
  ): LinkingKey[] {
    const all: LinkingKey[] = [];
    for (const entry of entries) {
      all.push(...this.extract(entry, schema, defaultEntityType));
    }
    return all;
  }
}
