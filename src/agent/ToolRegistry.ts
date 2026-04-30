import type { Tool } from "../models/Tool.js";

export class ToolRegistry {
  private readonly tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  lookup(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): readonly Tool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): Array<{ name: string; description: string; input_schema: unknown }> {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
}
