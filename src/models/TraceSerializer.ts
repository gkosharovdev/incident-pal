import type { TraceEntry } from "./Investigation.js";
import { Trace } from "./Trace.js";

const CURRENT_SCHEMA_VERSION = "1.0.0";

export interface SerializedTrace {
  schemaVersion: string;
  investigationId: string;
  entries: TraceEntry[];
}

export class TraceSerializer {
  serialize(trace: Trace): SerializedTrace {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      investigationId: trace.investigationId,
      entries: [...trace.getEntries()],
    };
  }

  toJSON(trace: Trace): string {
    return JSON.stringify(this.serialize(trace), null, 2);
  }

  deserialize(json: string): SerializedTrace {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("TraceSerializer: invalid JSON input");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("TraceSerializer: parsed value is not an object");
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj["schemaVersion"] !== "string") {
      throw new Error("TraceSerializer: missing or invalid schemaVersion");
    }

    if (typeof obj["investigationId"] !== "string") {
      throw new Error("TraceSerializer: missing or invalid investigationId");
    }

    if (!Array.isArray(obj["entries"])) {
      throw new Error("TraceSerializer: entries must be an array");
    }

    return {
      schemaVersion: obj["schemaVersion"],
      investigationId: obj["investigationId"],
      entries: obj["entries"] as TraceEntry[],
    };
  }

  toTrace(serialized: SerializedTrace): Trace {
    const trace = new Trace(serialized.investigationId);
    for (const entry of serialized.entries) {
      trace.appendEntry(entry);
    }
    return trace;
  }
}
