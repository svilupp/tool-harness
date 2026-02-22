import { tool } from "ai";
import { z } from "zod";
import { toolSignature } from "./describe/signature.ts";
import type { ToolHarness } from "./harness.ts";
import type { Category, ToolDef } from "./types.ts";

const reasoningField = z
	.string()
	.optional()
	.describe(
		"Optional. If args have enum values, write the exact enum string you'll use.",
	);

/**
 * Build a z.object schema for task tools with z.enum on the name field.
 * This keeps `type: "object"` at the JSON schema root (required by Anthropic)
 * while constraining the model to valid tool names.
 * Args remain flexible — the typed signatures in the description + repair pipeline
 * guide the model to correct values.
 */
function buildTaskSchema(
	tools: Array<{ name: string; tool: ToolDef }>,
): z.ZodType {
	if (tools.length === 0) {
		return z.object({
			reasoning: reasoningField,
			name: z.string().describe("Task name"),
			args: z
				.record(z.string(), z.any())
				.default({})
				.describe("Task arguments"),
		});
	}

	const names = tools.map(({ name }) => name);

	return z.object({
		reasoning: reasoningField,
		name: z.enum(names as [string, ...string[]]).describe("Task to execute"),
		args: z.record(z.string(), z.any()).default({}).describe("Task arguments"),
	});
}

/**
 * Build a typed schema for read-category tools + virtual paths.
 */
function buildReadSchema(
	tools: Array<{ name: string; tool: ToolDef }>,
): z.ZodType {
	const targetValues = ["tools", ...tools.map(({ name }) => name)];

	return z.object({
		reasoning: reasoningField,
		target: z
			.string()
			.describe(
				`What to read. Valid targets: ${targetValues.join(", ")}. Also supports tools/<name> for tool details.`,
			),
		head: z.number().optional().describe("Read first N lines"),
		tail: z.number().optional().describe("Read last N lines"),
		show: z.boolean().optional().describe("Show result to user"),
	});
}

/**
 * Build a typed schema for search-category tools.
 */
function buildSearchSchema(
	tools: Array<{ name: string; tool: ToolDef }>,
): z.ZodType {
	if (tools.length === 0) {
		return z.object({
			reasoning: reasoningField,
			query: z.string().describe("Search query"),
			scope: z.string().optional().describe("Search scope"),
			limit: z.number().optional().describe("Max results"),
			since: z.string().optional().describe("Time filter"),
			show: z.boolean().optional().describe("Show results to user"),
		});
	}

	if (tools.length === 1 && tools[0]) {
		const t = tools[0].tool;
		return z
			.object({
				reasoning: reasoningField,
			})
			.extend(
				t.schema.extend({
					show: z.boolean().optional().describe("Show results to user"),
				}).shape,
			);
	}

	// Multiple search tools: add a mode enum
	const modes = tools.map(({ name }) => name);
	const firstTool = tools[0];
	if (!firstTool) {
		return z.object({
			reasoning: reasoningField,
			query: z.string().describe("Search query"),
		});
	}

	return z
		.object({
			reasoning: reasoningField,
		})
		.extend(
			firstTool.tool.schema.extend({
				mode: z
					.enum(modes as [string, ...string[]])
					.optional()
					.describe("Search mode"),
				show: z.boolean().optional().describe("Show results to user"),
			}).shape,
		);
}

export function buildMetaTools(
	harness: ToolHarness,
	options?: { excludeNames?: Set<string>; hideNames?: Set<string> },
) {
	const exclude = options?.excludeNames ?? new Set<string>();
	const hide = options?.hideNames ?? new Set<string>();

	// Task tools for schema (all non-excluded, including hidden — they can be dispatched)
	const taskToolsForSchema = harness.registry
		.list("task")
		.filter(({ name }) => !exclude.has(name));
	// Task tools for description (non-excluded AND non-hidden — hidden tools don't appear in description)
	const taskToolsForDesc = taskToolsForSchema.filter(
		({ name }) => !hide.has(name),
	);

	const taskSigs = taskToolsForDesc
		.map(({ name, tool: t }) => `  ${toolSignature(name, t)}`)
		.join("\n");
	const taskDesc =
		taskToolsForDesc.length > 0
			? `Execute a named task.\n\nAvailable tasks:\n${taskSigs}`
			: "Execute a named task.";

	// Build read description
	const readTools = harness.registry.list("read");
	const readSigs = readTools
		.map(({ name, tool: t }) => `  ${toolSignature(name, t)}`)
		.join("\n");
	const readDesc =
		readTools.length > 0
			? `Read information from a target.\n\nAvailable targets:\n${readSigs}\n\nVirtual paths: tools, tools/<name>`
			: "Read information. Virtual paths: tools, tools/<name>";

	// Build search description
	const searchTools = harness.registry.list("search");
	const searchSigs = searchTools
		.map(({ name, tool: t }) => `  ${toolSignature(name, t)}`)
		.join("\n");
	const searchDesc =
		searchTools.length > 0
			? `Search for information.\n\nAvailable search modes:\n${searchSigs}`
			: "Search for information.";

	// Build typed schemas (use full schema list so hidden tools are dispatchable)
	const taskInputSchema = buildTaskSchema(taskToolsForSchema);
	const readInputSchema = buildReadSchema(readTools);
	const searchInputSchema = buildSearchSchema(searchTools);

	const makeTool = (desc: string, schema: z.ZodType, category: string) =>
		tool({
			description: desc,
			inputSchema: schema,
			execute: async (
				input: Record<string, unknown>,
				options: Record<string, unknown>,
			) => {
				const { reasoning: _reasoning, ...dispatchInput } = input;
				const result = await harness.dispatch(
					category as Category,
					dispatchInput,
					{
						toolCallId: options["toolCallId"] as string,
						experimental_context: options["experimental_context"],
					},
				);
				return result;
			},
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() accepts dynamic option shapes
		} as any);

	return {
		read: makeTool(readDesc, readInputSchema, "read"),
		search: makeTool(searchDesc, searchInputSchema, "search"),
		task: makeTool(taskDesc, taskInputSchema, "task"),
	};
}
