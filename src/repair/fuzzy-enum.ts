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

		// 3. Levenshtein with word-overlap guard for longer strings
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
		const minLen = Math.min(value.length, bestOption?.length ?? 0);
		const threshold = minLen > 5 ? 0.65 : 0.5;
		const needsOverlapCheck = minLen > 5;
		if (
			bestOption &&
			bestSim >= threshold &&
			(!needsOverlapCheck || hasWordOverlap(value, bestOption))
		) {
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

/**
 * Split a string into words by `_`, `-`, ` `, and camelCase boundaries.
 */
function splitWords(s: string): string[] {
	// Insert boundary before uppercase letters for camelCase
	const spaced = s.replace(/([a-z])([A-Z])/g, "$1 $2");
	return spaced
		.split(/[_\- ]+/)
		.map((w) => w.toLowerCase())
		.filter((w) => w.length > 0);
}

/**
 * Returns true if the input and match share at least one common substring
 * of length >= 3 across their word boundaries.
 */
function hasWordOverlap(input: string, match: string): boolean {
	const inputWords = splitWords(input).filter((w) => w.length >= 3);
	const matchWords = splitWords(match).filter((w) => w.length >= 3);

	for (const iw of inputWords) {
		for (const mw of matchWords) {
			// Check if any 3+ char substring is shared
			if (sharesSubstring(iw, mw, 3)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Returns true if two strings share a common substring of at least `minLen` characters.
 */
function sharesSubstring(a: string, b: string, minLen: number): boolean {
	const shorter = a.length <= b.length ? a : b;
	const longer = a.length <= b.length ? b : a;
	for (let len = shorter.length; len >= minLen; len--) {
		for (let i = 0; i <= shorter.length - len; i++) {
			if (longer.includes(shorter.substring(i, i + len))) {
				return true;
			}
		}
	}
	return false;
}
