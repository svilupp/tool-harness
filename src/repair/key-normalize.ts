import { distance } from "fastest-levenshtein";
import type { RepairAction } from "../types.ts";

function camelToSnake(s: string): string {
	return s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function snakeToCamel(s: string): string {
	return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function normalizeKeys(
	input: Record<string, unknown>,
	schemaKeys: string[],
): { data: Record<string, unknown>; repairs: RepairAction[] } {
	const result: Record<string, unknown> = {};
	const repairs: RepairAction[] = [];
	const schemaKeySet = new Set(schemaKeys);
	const schemaKeysLower = new Map(schemaKeys.map((k) => [k.toLowerCase(), k]));

	for (const [key, value] of Object.entries(input)) {
		// Already a valid key
		if (schemaKeySet.has(key)) {
			result[key] = value;
			continue;
		}

		// 1. Case-insensitive match
		const ciMatch = schemaKeysLower.get(key.toLowerCase());
		if (ciMatch) {
			result[ciMatch] = value;
			repairs.push({
				field: ciMatch,
				original: key,
				repaired: ciMatch,
				strategy: "key_normalize",
			});
			continue;
		}

		// 2. camelCase ↔ snake_case
		const snakeKey = camelToSnake(key);
		const camelKey = snakeToCamel(key);
		const convMatch = schemaKeys.find(
			(sk) =>
				sk === snakeKey ||
				sk === camelKey ||
				sk.toLowerCase() === snakeKey ||
				sk.toLowerCase() === camelKey,
		);
		if (convMatch) {
			result[convMatch] = value;
			repairs.push({
				field: convMatch,
				original: key,
				repaired: convMatch,
				strategy: "key_normalize",
			});
			continue;
		}

		// 3. Levenshtein fuzzy match (≥ 0.75)
		let bestKey: string | null = null;
		let bestSim = 0;
		for (const sk of schemaKeys) {
			const d = distance(key.toLowerCase(), sk.toLowerCase());
			const maxLen = Math.max(key.length, sk.length);
			const sim = 1 - d / maxLen;
			if (sim > bestSim) {
				bestSim = sim;
				bestKey = sk;
			}
		}
		if (bestKey && bestSim >= 0.75) {
			result[bestKey] = value;
			repairs.push({
				field: bestKey,
				original: key,
				repaired: bestKey,
				strategy: "key_normalize",
			});
			continue;
		}

		// No match — keep as-is (will fail validation later)
		result[key] = value;
	}

	return { data: result, repairs };
}
