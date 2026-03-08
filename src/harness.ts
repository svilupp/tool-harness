import { tool } from "ai";
import { z } from "zod";
import type { PromptBlockOptions } from "./describe/prompt-block.ts";
import { generatePromptBlock as genBlock } from "./describe/prompt-block.ts";
import { toolSignature } from "./describe/signature.ts";
import { toolDetail as genDetail } from "./describe/tool-detail.ts";
import { buildDirectTools } from "./direct-tools.ts";
import { getFields } from "./introspect.ts";
import { buildMetaTools } from "./meta-tools.ts";
import { ToolRegistry } from "./registry.ts";
import { repairArgs, repairJSON as repairJSONFn } from "./repair/index.ts";
import type {
	Category,
	HarnessConfig,
	RepairAction,
	RepairResult,
	ToolDef,
	ToolDefs,
	ToolExecutionContext,
} from "./types.ts";

export function defineTools<T extends ToolDefs>(tools: T): T {
	return tools;
}

export class ToolHarness {
	readonly registry: ToolRegistry;
	private config: HarnessConfig;

	constructor(tools: ToolDefs, config: HarnessConfig = {}) {
		this.registry = new ToolRegistry();
		this.config = config;
		for (const [name, def] of Object.entries(tools)) {
			this.registry.register(name, def);
		}
	}

	async dispatch(
		category: Category,
		input: Record<string, unknown>,
		context?: ToolExecutionContext,
	): Promise<unknown> {
		if (category === "task") {
			const taskName = input["name"] as string;
			const args = (input["args"] as Record<string, unknown>) ?? {};
			const resolved = this.registry.resolve(taskName);
			if (!resolved) {
				return {
					error: `Unknown task: "${taskName}"`,
					availableTools: this.registry.listNames("task"),
				};
			}
			const repairResult = await this.repairAndExecute(
				resolved.name,
				resolved.tool,
				args,
				context,
			);
			return repairResult;
		}

		if (category === "read") {
			const { target, ...restArgs } = input;

			// Virtual paths: tools, tools/<name>
			if (target === "tools") return this.listToolSummaries();
			if (typeof target === "string" && target.startsWith("tools/")) {
				const toolName = target.slice(6);
				return this.getToolDetail(toolName);
			}

			// Route to read-category tools
			const readTools = this.registry.list("read");
			// Try to resolve target as a tool name
			const resolved =
				typeof target === "string" ? this.registry.resolve(target) : null;
			if (resolved && resolved.tool.category === "read") {
				const toolArgs = this.buildReadArgs(
					resolved.tool,
					target as string,
					restArgs,
				);
				return this.repairAndExecute(
					resolved.name,
					resolved.tool,
					toolArgs,
					context,
				);
			}
			// Fallback: use first read tool, pass target as first required string param
			if (readTools.length > 0 && readTools[0]) {
				const first = readTools[0];
				const toolArgs = this.buildReadArgs(
					first.tool,
					target as string,
					restArgs,
				);
				return this.repairAndExecute(first.name, first.tool, toolArgs, context);
			}
			return { error: `No read tools available for target: "${target}"` };
		}

		if (category === "search") {
			const searchTools = this.registry.list("search");
			if (searchTools.length === 0 || !searchTools[0])
				return { error: "No search tools available" };
			const first = searchTools[0];
			return this.repairAndExecute(first.name, first.tool, input, context);
		}

		return { error: `Unknown category: "${category}"` };
	}

	async repair(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<RepairResult> {
		const resolved = this.registry.resolve(toolName);
		if (!resolved) {
			return {
				ok: false,
				error: {
					toolName,
					issues: [
						{ path: "(tool)", expected: "valid tool name", received: toolName },
					],
					availableTools: this.registry.listNames(),
				},
			};
		}
		const result = repairArgs(args, resolved.tool.schema, {
			repairModel: this.config.repairModel,
			toolName: resolved.name,
			availableTools: this.registry.listNames(),
			repairPolicy: this.config.repairPolicy,
			onEvent: this.config.onEvent,
		});
		return result instanceof Promise ? await result : result;
	}

	repairJSON(raw: string): Record<string, unknown> | null {
		const result = repairJSONFn(raw);
		return result?.data ?? null;
	}

	generatePromptBlock(options?: PromptBlockOptions): string {
		const allTools = this.registry.list();
		return genBlock(allTools, options);
	}

	getToolDetail(name: string): string {
		const resolved = this.registry.resolve(name);
		if (!resolved)
			return `Unknown tool: "${name}". Available: ${this.registry.listNames().join(", ")}`;
		return genDetail(resolved.name, resolved.tool);
	}

	listToolSummaries(): string {
		return this.registry
			.list()
			.map(({ name, tool }) => toolSignature(name, tool))
			.join("\n");
	}

	loadTools(defs: ToolDefs): void {
		for (const [name, def] of Object.entries(defs)) {
			this.registry.register(name, def);
		}
	}

	unloadTools(names: string[]): void {
		for (const name of names) {
			this.registry.unregister(name);
		}
	}

	toMetaTools() {
		return buildMetaTools(this);
	}

	toDirectTools() {
		return buildDirectTools(this);
	}

	toHybridTools() {
		return buildHybridTools(this);
	}

	repairHook(options?: { mode?: "direct" | "meta" | "hybrid" }) {
		return buildRepairHook(this, options);
	}

	private buildReadArgs(
		tool: ToolDef,
		target: string,
		extraArgs: Record<string, unknown>,
	): Record<string, unknown> {
		// Map the meta-tool's "target" to the first required string field of the tool's schema
		const fields = getFields(tool.schema);
		const firstStringField = fields.required.find(
			(f) => f.unwrapped instanceof z.ZodString,
		);
		if (firstStringField) {
			return { [firstStringField.name]: target, ...extraArgs };
		}
		return { target, ...extraArgs };
	}

	private async repairAndExecute(
		toolName: string,
		tool: ToolDef,
		args: Record<string, unknown>,
		context?: ToolExecutionContext,
	): Promise<unknown> {
		const result = repairArgs(args, tool.schema, {
			repairModel: this.config.repairModel,
			toolName,
			availableTools: this.registry.listNames(),
			repairPolicy: this.config.repairPolicy,
			onEvent: this.config.onEvent,
		});
		const resolved = result instanceof Promise ? await result : result;
		if (!resolved.ok) return resolved.error;
		const execResult = await tool.execute(resolved.data, context);
		return this.annotateWithRepairs(execResult, resolved.repairs);
	}

	private annotateWithRepairs(
		result: unknown,
		repairs: RepairAction[],
	): unknown {
		// Only annotate actual corrections, not default injections
		const meaningful = repairs?.filter((r) => r.strategy !== "default") ?? [];
		if (meaningful.length === 0) return result;

		const note = `\u26a0\ufe0f Args adjusted: ${meaningful
			.map((r) => `${r.field}: "${r.original}" \u2192 "${r.repaired}"`)
			.join("; ")}. Use exact enum values from tool signatures.`;

		if (
			result !== null &&
			typeof result === "object" &&
			!Array.isArray(result)
		) {
			return { ...result, _repairNote: note };
		}
		if (typeof result === "string") {
			return `${result}\n\n${note}`;
		}
		return { _result: result, _repairNote: note };
	}
}

function buildHybridTools(harness: ToolHarness) {
	// Collect always+task tools for direct exposure
	const allTools = harness.registry.list();
	const directNames = new Set<string>();
	const directResult: Record<string, ReturnType<typeof tool>> = {};

	for (const { name, tool: def } of allTools) {
		if (def.visibility === "always" && def.category === "task") {
			directNames.add(name);

			const toolOpts: Record<string, unknown> = {
				description: def.description,
				inputSchema: def.schema,
				execute: async (
					input: Record<string, unknown>,
					options: { toolCallId: string },
				) => {
					return def.execute(input, {
						toolCallId: options.toolCallId,
						// biome-ignore lint/suspicious/noExplicitAny: AI SDK options type is not exported
						experimental_context: (options as any).experimental_context,
					});
				},
			};

			if (def.toModelOutput) {
				toolOpts["experimental_toModelOutput"] = def.toModelOutput;
			}

			// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() accepts dynamic option shapes
			directResult[name] = tool(toolOpts as any);
		}
	}

	// Collect hidden tool names (for excluding from description but keeping in schema)
	const hiddenNames = new Set<string>();
	for (const { name, tool: def } of allTools) {
		if (def.visibility === "hidden" && !directNames.has(name)) {
			hiddenNames.add(name);
		}
	}

	// Build meta-tools excluding the direct-exposed tools, hiding hidden tools from description
	const metaTools = buildMetaTools(harness, {
		excludeNames: directNames,
		hideNames: hiddenNames,
	});

	return { ...directResult, ...metaTools };
}

function buildRepairHook(
	harness: ToolHarness,
	options?: { mode?: "direct" | "meta" | "hybrid" },
) {
	const mode = options?.mode ?? "direct";

	return async ({
		toolCall,
		tools: _tools,
		error,
	}: {
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK repair hook types are not exported
		toolCall: any;
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK repair hook types are not exported
		tools: Record<string, any>;
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK repair hook types are not exported
		error: any;
	}) => {
		// Handle InvalidToolInputError
		if (
			error?.name === "AI_InvalidToolArgumentsError" ||
			error?.constructor?.name === "InvalidToolInputError"
		) {
			const toolName = toolCall.toolName;
			const resolved = harness.registry.resolve(toolName);
			if (!resolved) return null;

			let args: Record<string, unknown>;
			try {
				args =
					typeof toolCall.args === "string"
						? JSON.parse(toolCall.args)
						: toolCall.args;
			} catch {
				const fixed = harness.repairJSON(
					typeof toolCall.args === "string"
						? toolCall.args
						: JSON.stringify(toolCall.args),
				);
				if (!fixed) return null;
				args = fixed;
			}

			const result = await harness.repair(toolName, args);
			if (result.ok) {
				return { ...toolCall, args: JSON.stringify(result.data) };
			}
			return null;
		}

		// Handle NoSuchToolError
		if (
			error?.name === "AI_NoSuchToolError" ||
			error?.constructor?.name === "NoSuchToolError"
		) {
			const resolved = harness.registry.resolve(toolCall.toolName);
			if (!resolved) return null;

			let args: Record<string, unknown>;
			try {
				args =
					typeof toolCall.args === "string"
						? JSON.parse(toolCall.args)
						: toolCall.args;
			} catch {
				args = {};
			}

			// In hybrid mode: listed/hidden task tools should be rewritten as task meta-tool calls
			if (
				mode === "hybrid" &&
				resolved.tool.category === "task" &&
				resolved.tool.visibility !== "always"
			) {
				const repairedArgs = await harness.repair(resolved.name, args);
				const taskArgs = {
					name: resolved.name,
					args: repairedArgs.ok ? repairedArgs.data : args,
				};
				return {
					...toolCall,
					toolName: "task",
					args: JSON.stringify(taskArgs),
				};
			}

			const result = await harness.repair(resolved.name, args);
			if (result.ok) {
				return {
					...toolCall,
					toolName: resolved.name,
					args: JSON.stringify(result.data),
				};
			}
			return null;
		}

		return null;
	};
}

export function createHarness(
	tools: ToolDefs,
	config?: HarnessConfig,
): ToolHarness {
	return new ToolHarness(tools, config);
}
