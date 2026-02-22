import { z } from "zod";
import type { RepairAction } from "../types.ts";

export function injectDefaults(
	input: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
): { data: Record<string, unknown>; repairs: RepairAction[] } {
	const result = { ...input };
	const repairs: RepairAction[] = [];
	const shape = schema.shape as Record<string, z.ZodType>;

	for (const [key, fieldSchema] of Object.entries(shape)) {
		if (key in result && result[key] !== undefined) continue;

		if (fieldSchema instanceof z.ZodDefault) {
			const defaultVal = fieldSchema._def.defaultValue;
			result[key] = defaultVal;
			repairs.push({
				field: key,
				original: undefined,
				repaired: defaultVal,
				strategy: "default",
			});
		}
	}

	return { data: result, repairs };
}
