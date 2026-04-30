export type LinkingKey =
  | { type: "entity-id"; entityType: string; value: string }
  | { type: "http-correlation"; value: string }
  | { type: "kafka-message-id"; value: string };

export type LinkingKeyType = LinkingKey["type"];

export function linkingKeyId(key: LinkingKey): string {
  if (key.type === "entity-id") {
    return `entity-id:${key.entityType}:${key.value}`;
  }
  return `${key.type}:${key.value}`;
}

export class LinkingKeySet {
  private readonly keys: Map<string, LinkingKey> = new Map();

  add(key: LinkingKey): boolean {
    const id = linkingKeyId(key);
    if (this.keys.has(id)) return false;
    this.keys.set(id, key);
    return true;
  }

  has(key: LinkingKey): boolean {
    return this.keys.has(linkingKeyId(key));
  }

  snapshot(): readonly LinkingKey[] {
    return Array.from(this.keys.values());
  }

  get size(): number {
    return this.keys.size;
  }
}
