import { z } from "zod";
import { unwrapSchema } from "../introspect.ts";
import type { RepairAction } from "../types.ts";

const BOOL_MAP: Record<string, boolean> = {
	true: true,
	false: false,
	yes: true,
	no: false,
	"1": true,
	"0": false,
};

export function coerceTypes(
	input: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
): { data: Record<string, unknown>; repairs: RepairAction[] } {
	const result = { ...input };
	const repairs: RepairAction[] = [];
	const shape = schema.shape as Record<string, z.ZodType>;

	for (const [key, fieldSchema] of Object.entries(shape)) {
		if (!(key in result)) continue;
		const value = result[key];
		const unwrapped = unwrapSchema(fieldSchema);

		// String → Number
		if (unwrapped instanceof z.ZodNumber && typeof value === "string") {
			if (value.trim() === "") {
				// Empty string for number → remove (let defaults/required handle it)
				delete result[key];
				repairs.push({
					field: key,
					original: value,
					repaired: undefined,
					strategy: "coerce",
				});
				continue;
			}
			const num = Number(value);
			if (!Number.isNaN(num)) {
				result[key] = num;
				repairs.push({
					field: key,
					original: value,
					repaired: num,
					strategy: "coerce",
				});
			}
		}

		// String → Boolean (custom, NOT z.coerce)
		if (unwrapped instanceof z.ZodBoolean && typeof value === "string") {
			const mapped = BOOL_MAP[value.toLowerCase()];
			if (mapped !== undefined) {
				result[key] = mapped;
				repairs.push({
					field: key,
					original: value,
					repaired: mapped,
					strategy: "coerce",
				});
			}
		}

		// Single value → Array
		if (
			unwrapped instanceof z.ZodArray &&
			!Array.isArray(value) &&
			value !== undefined
		) {
			result[key] = [value];
			repairs.push({
				field: key,
				original: value,
				repaired: [value],
				strategy: "coerce",
			});
		}
	}

	return { data: result, repairs };
}
