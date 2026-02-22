import { z } from "zod";
import { unwrapSchema } from "../introspect.ts";
import type { RepairAction } from "../types.ts";

/**
 * Common abbreviation expansions used in enum values.
 */
export const ABBREVIATIONS: Record<string, string> = {
	mem: "memory",
	cfg: "config",
	config: "configuration",
	db: "database",
	pct: "percent",
	svc: "service",
	srv: "server",
	req: "request",
	res: "response",
	msg: "message",
	err: "error",
	auth: "authentication",
	info: "information",
	env: "environment",
	dir: "directory",
	tmp: "temporary",
	temp: "temporary",
	proc: "process",
	num: "number",
	str: "string",
	val: "value",
	max: "maximum",
	min: "minimum",
	avg: "average",
	cnt: "count",
	idx: "index",
	len: "length",
	buf: "buffer",
	fmt: "format",
	src: "source",
	dst: "destination",
	desc: "description",
	asc: "ascending",
	prev: "previous",
	cur: "current",
	init: "initialize",
	del: "delete",
	rm: "remove",
	exec: "execute",
	impl: "implementation",
	obj: "object",
	fn: "function",
	param: "parameter",
	arg: "argument",
	opt: "option",
	prio: "priority",
	cpu: "cpu",
	gpu: "gpu",
	gb: "gb",
	mb: "mb",
};

const MATCH_THRESHOLD = 0.55;
const AMBIGUITY_MARGIN = 0.15;

/**
 * Layer 4b: Semantic enum matching.
 *
 * Runs after fuzzy-enum (Layer 4) and before defaults (Layer 5).
 * Only processes string fields that have an enum schema and whose current
 * value is NOT already a valid enum member (i.e., fuzzy-enum didn't fix it).
 *
 * Four strategies tried in order:
 * 1. Normalize + exact match
 * 2. Word overlap (>= 60% of enum words present in input)
 * 3. Substring containment
 * 4. Abbreviation expansion + word overlap retry
 */
export function semanticMatchEnums(
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

		// Skip if already valid (fuzzy-enum already fixed it)
		if (options.includes(value)) continue;

		const match = findSemanticMatch(value, options);
		if (match) {
			result[key] = match;
			repairs.push({
				field: key,
				original: value,
				repaired: match,
				strategy: "semantic_enum",
			});
		}
	}

	return { data: result, repairs };
}

interface ScoredMatch {
	option: string;
	score: number;
}

/**
 * Try all four strategies and return the best unambiguous match, or null.
 */
function findSemanticMatch(input: string, options: string[]): string | null {
	const scored: ScoredMatch[] = [];

	for (const option of options) {
		const score = bestStrategyScore(input, option);
		if (score >= MATCH_THRESHOLD) {
			scored.push({ option, score });
		}
	}

	if (scored.length === 0) return null;

	// Sort descending by score
	scored.sort((a, b) => b.score - a.score);

	const best = scored[0] as ScoredMatch;

	// Reject if ambiguous: best and second-best are too close
	if (
		scored.length > 1 &&
		best.score - (scored[1]?.score ?? 0) < AMBIGUITY_MARGIN
	) {
		return null;
	}

	return best.option;
}

/**
 * Returns the highest score across all four strategies for input vs a single enum option.
 */
function bestStrategyScore(input: string, option: string): number {
	return Math.max(
		normalizeExactScore(input, option),
		wordOverlapScore(input, option),
		substringScore(input, option),
		abbreviationOverlapScore(input, option),
	);
}

// ---------------------------------------------------------------------------
// Strategy 1: Normalize + exact match
// ---------------------------------------------------------------------------

function normalize(s: string): string {
	return s
		.toLowerCase()
		.replace(/[_\-\s]+/g, "")
		.replace(/(ing|ed|tion|ment|ness)$/, ""); // strip common suffixes
}

function normalizeExactScore(input: string, option: string): number {
	return normalize(input) === normalize(option) ? 1.0 : 0;
}

// ---------------------------------------------------------------------------
// Strategy 2: Word overlap
// ---------------------------------------------------------------------------

/**
 * Tokenize a string into lowercase words, splitting on underscores, hyphens,
 * spaces, and camelCase boundaries.
 */
function tokenize(s: string): string[] {
	// Insert space before uppercase letters in camelCase
	const spaced = s.replace(/([a-z])([A-Z])/g, "$1 $2");
	return spaced
		.toLowerCase()
		.split(/[_\-\s]+/)
		.filter((w) => w.length > 0);
}

function wordOverlapScore(input: string, option: string): number {
	const inputWords = new Set(tokenize(input));
	const optionWords = tokenize(option);

	if (optionWords.length === 0) return 0;

	let matches = 0;
	for (const word of optionWords) {
		if (inputWords.has(word)) matches++;
	}

	const overlap = matches / optionWords.length;
	// Require >= 60% overlap to count as a match at all
	return overlap >= 0.6 ? overlap : 0;
}

// ---------------------------------------------------------------------------
// Strategy 3: Substring containment
// ---------------------------------------------------------------------------

function substringScore(input: string, option: string): number {
	const inputLower = input.toLowerCase();
	const optionAsPhrase = option.toLowerCase().replace(/[_-]+/g, " ");

	if (
		inputLower.includes(optionAsPhrase) ||
		optionAsPhrase.includes(inputLower)
	) {
		// Score based on length ratio (longer match relative to total = higher)
		const shorter = Math.min(inputLower.length, optionAsPhrase.length);
		const longer = Math.max(inputLower.length, optionAsPhrase.length);
		return shorter / longer;
	}

	return 0;
}

// ---------------------------------------------------------------------------
// Strategy 4: Abbreviation expansion + word overlap retry
// ---------------------------------------------------------------------------

function expandAbbreviations(words: string[]): string[] {
	return words.map((w) => ABBREVIATIONS[w] ?? w);
}

function abbreviationOverlapScore(input: string, option: string): number {
	const inputWords = expandAbbreviations(tokenize(input));
	const optionWords = expandAbbreviations(tokenize(option));

	const inputSet = new Set(inputWords);
	const optionSet = new Set(optionWords);

	if (optionWords.length === 0 || inputWords.length === 0) return 0;

	// How many input words appear in the option
	let inputInOption = 0;
	for (const word of inputWords) {
		if (optionSet.has(word)) inputInOption++;
	}

	// How many option words appear in the input
	let optionInInput = 0;
	for (const word of optionWords) {
		if (inputSet.has(word)) optionInInput++;
	}

	const inputCoverage = inputInOption / inputWords.length;
	const optionCoverage = optionInInput / optionWords.length;

	// Use the higher of the two coverage ratios, but require at least 60%
	// on the input side (most of what the user said should be in the enum)
	const score = Math.max(inputCoverage, optionCoverage);
	return inputCoverage >= 0.6 ? score : 0;
}
