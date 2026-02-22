import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { RepairAction } from "../types.ts";

export async function aiRepair(
	args: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
	model: LanguageModel,
	toolName: string,
): Promise<{ data: Record<string, unknown>; repairs: RepairAction[] } | null> {
	try {
		// Dynamic import to keep ai as optional
		const { generateObject } = await import("ai");

		const result = await generateObject({
			model,
			schema,
			prompt: `Fix this tool call input to match the schema.

Tool: ${toolName}
Input: ${JSON.stringify(args)}

Return the corrected input object matching the schema exactly.`,
		});

		return {
			data: result.object as Record<string, unknown>,
			repairs: [
				{
					field: "_all",
					original: args,
					repaired: result.object,
					strategy: "ai_repair",
				},
			],
		};
	} catch {
		return null;
	}
}
