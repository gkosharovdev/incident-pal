import type { JSONSchema7 } from "./JSONSchema.js";

export interface ToolResult {
  success: boolean;
  data: unknown;
  error: string | null;
  scanBytesUsed?: number;
  truncated?: boolean;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema7;
  invoke(input: unknown): Promise<ToolResult>;
}
