import { distance } from "fastest-levenshtein";
import { z } from "zod";
import { unwrapSchema } from "../introspect.ts";
import type { RepairAction } from "../types.ts";

export function fuzzyMatchEnums(
	input: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
): { data: Record<string, unknown>; repairs: RepairAction[] } {
	const result = { ...input };
	const repairs: RepairAction[] = [];
	const shape = schema.shape as Record<string, z.ZodType>;

	for (const [key, fieldSchema] of Object.entries(shape)) {
		if (!(key in result) || typeof result[key] !== "string") continue;
		const value = result[key] as string;
		const unwrapped = unwrapSchema(fieldSchema);

		if (!(unwrapped instanceof z.ZodEnum)) continue;
		const options = unwrapped.options as string[];

		// Already valid
		if (options.includes(value)) continue;

		// 1. Case-insensitive exact
		const ciMatch = options.find(
			(o) => o.toLowerCase() === value.toLowerCase(),
		);
		if (ciMatch) {
			result[key] = ciMatch;
			repairs.push({
				field: key,
				original: value,
				repaired: ciMatch,
				strategy: "fuzzy_enum",
			});
			continue;
		}

		// 2. Prefix match (if unique)
		const prefixMatches = options.filter((o) =>
			o.toLowerCase().startsWith(value.toLowerCase()),
		);
		if (prefixMatches.length === 1 && prefixMatches[0]) {
			result[key] = prefixMatches[0];
			repairs.push({
				field: key,
				original: value,
				repaired: prefixMatches[0],
				strategy: "fuzzy_enum",
			});
			continue;
		}

		// 3. Levenshtein (≥ 0.6)
		let bestOption: string | null = null;
		let bestSim = 0;
		for (const opt of options) {
			const d = distance(value.toLowerCase(), opt.toLowerCase());
			const maxLen = Math.max(value.length, opt.length);
			const sim = 1 - d / maxLen;
			if (sim > bestSim) {
				bestSim = sim;
				bestOption = opt;
			}
		}
		if (bestOption && bestSim >= 0.5) {
			result[key] = bestOption;
			repairs.push({
				field: key,
				original: value,
				repaired: bestOption,
				strategy: "fuzzy_enum",
			});
		}
	}

	return { data: result, repairs };
}
