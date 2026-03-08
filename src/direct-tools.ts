import { tool } from "ai";
import type { ToolHarness } from "./harness.ts";

export function buildDirectTools(harness: ToolHarness) {
	const result: Record<string, ReturnType<typeof tool>> = {};
	const allTools = harness.registry.list();

	for (const { name, tool: def } of allTools) {
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
		result[name] = tool(toolOpts as any);
	}

	return result;
}
