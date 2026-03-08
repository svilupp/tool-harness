import { tool } from "ai";
import type { Capability, TurnContext } from "./capability.ts";

export interface CompileOptions {
	maxTools?: number; // default 8
	provider?: string; // 'google' | 'anthropic' | 'openai'
	includeRepairHook?: boolean;
	fallbackMode?: "strict" | "permissive"; // default "strict"
}

export interface CompileResult {
	tools: Record<string, ReturnType<typeof tool>>;
	metadata: {
		offeredTools: string[];
		hiddenTools: string[];
		compileMs: number;
	};
}

export function compileTools(
	capabilities: Capability[],
	context: TurnContext,
	options?: CompileOptions,
): CompileResult {
	const start = performance.now();
	const maxTools = options?.maxTools ?? 8;
	const fallbackMode = options?.fallbackMode ?? "strict";

	// 1. Filter capabilities by activation rules
	const active = capabilities.filter(
		(cap) =>
			cap.activationRules.length > 0 &&
			cap.activationRules.some((rule) => rule.condition(context)),
	);

	// 2. Sort by priority (higher first), then by registration order (stable)
	const sorted = [...active].sort(
		(a, b) => (b.tool.priority ?? 0) - (a.tool.priority ?? 0),
	);

	// 3. If permissive and under maxTools, fill remaining slots from inactive capabilities
	let candidates = sorted;
	if (fallbackMode === "permissive" && sorted.length < maxTools) {
		const activeNames = new Set(sorted.map((c) => c.name));
		const inactive = capabilities
			.filter((cap) => !activeNames.has(cap.name))
			// Exclude "never" rules (explicit opt-out)
			.filter((cap) => !cap.activationRules.some((r) => r.type === "never"))
			.sort((a, b) => (b.tool.priority ?? 0) - (a.tool.priority ?? 0));
		candidates = [...sorted, ...inactive];
	}

	// 4. Take top maxTools
	const selected = candidates.slice(0, maxTools);
	const hidden = candidates.slice(maxTools);

	// 5. Convert each to AI SDK tool()
	const tools: Record<string, ReturnType<typeof tool>> = {};
	for (const cap of selected) {
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() requires flexible typing
		const toolOpts: Record<string, any> = {
			description: cap.tool.description,
			inputSchema: cap.tool.schema,
			execute: async (
				input: Record<string, unknown>,
				opts: { toolCallId: string },
			) => {
				return cap.tool.execute(input, {
					toolCallId: opts.toolCallId,
					// biome-ignore lint/suspicious/noExplicitAny: experimental_context is untyped in AI SDK
					experimental_context: (opts as any).experimental_context,
				});
			},
		};

		if (cap.tool.toModelOutput) {
			toolOpts["experimental_toModelOutput"] = cap.tool.toModelOutput;
		}

		// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() overloads require cast
		tools[cap.name] = tool(toolOpts as any);
	}

	const compileMs = performance.now() - start;

	return {
		tools,
		metadata: {
			offeredTools: selected.map((c) => c.name),
			hiddenTools: hidden.map((c) => c.name),
			compileMs,
		},
	};
}
