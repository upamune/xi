import type { Filesystem, ToolCalls } from "agentfs-sdk";
import type { Bash } from "just-bash";
import { type BashTool, createBashTool } from "./bash.js";
import { createEditTool, type EditTool } from "./edit.js";
import { createReadTool, type ReadTool } from "./read.js";
import { createWriteTool, type WriteTool } from "./write.js";

export type { BashTool, EditTool, ReadTool, WriteTool };
export type Tool = ReadTool | WriteTool | EditTool | BashTool;
export type ToolName = Tool["name"];

export interface ToolRegistry {
	get<T extends Tool>(name: ToolName): T | undefined;
	getAll(): Map<ToolName, Tool>;
	register(tool: Tool): void;
}

class ToolRegistryImpl implements ToolRegistry {
	private tools = new Map<ToolName, Tool>();

	get<T extends Tool>(name: ToolName): T | undefined {
		return this.tools.get(name) as T | undefined;
	}

	getAll(): Map<ToolName, Tool> {
		return new Map(this.tools);
	}

	register(tool: Tool): void {
		this.tools.set(tool.name, tool);
	}
}

export function createToolRegistry(bash: Bash, fs: Filesystem, tools: ToolCalls): ToolRegistry {
	const registry = new ToolRegistryImpl();

	registry.register(createReadTool(bash, tools));
	registry.register(createWriteTool(fs, tools));
	registry.register(createEditTool(bash, fs, tools));
	registry.register(createBashTool(bash, tools));

	return registry;
}
