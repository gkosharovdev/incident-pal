import type { TraceEntry } from "./Investigation.js";

export class Trace {
  private readonly entries: TraceEntry[] = [];
  readonly investigationId: string;

  constructor(investigationId: string) {
    this.investigationId = investigationId;
  }

  appendEntry(entry: TraceEntry): void {
    this.entries.push(Object.freeze({ ...entry }));
  }

  getEntries(): readonly TraceEntry[] {
    return this.entries;
  }

  get length(): number {
    return this.entries.length;
  }
}
