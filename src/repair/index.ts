import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { RepairAction, RepairResult } from "../types.ts";
import { aiRepair } from "./ai-repair.ts";
import { injectDefaults } from "./defaults.ts";
import { fuzzyMatchEnums } from "./fuzzy-enum.ts";
import { normalizeKeys } from "./key-normalize.ts";
import { semanticMatchEnums } from "./semantic-enum.ts";
import { buildStructuredError } from "./structured-error.ts";
import { synonymMatchEnums } from "./synonym-table.ts";
import { coerceTypes } from "./type-coerce.ts";

export { repairJSON } from "./json-repair.ts";

export function repairArgs(
	args: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
	options?: {
		repairModel?: LanguageModel | undefined;
		toolName?: string | undefined;
		availableTools?: string[] | undefined;
	},
): RepairResult | Promise<RepairResult> {
	const allRepairs: RepairAction[] = [];
	const schemaKeys = Object.keys(schema.shape as Record<string, unknown>);

	// Layer 2: Key normalization
	const normalized = normalizeKeys(args, schemaKeys);
	allRepairs.push(...normalized.repairs);
	let data = normalized.data;

	// Layer 3: Type coercion
	const coerced = coerceTypes(data, schema);
	allRepairs.push(...coerced.repairs);
	data = coerced.data;

	// Layer 4: Fuzzy enum matching
	const enumFixed = fuzzyMatchEnums(data, schema);
	allRepairs.push(...enumFixed.repairs);
	data = enumFixed.data;

	// Layer 4a: Synonym-table enum matching (catches paraphrases via pre-computed lookup)
	const synonymFixed = synonymMatchEnums(data, schema);
	allRepairs.push(...synonymFixed.repairs);
	data = synonymFixed.data;

	// Layer 4b: Semantic enum matching (catches natural language → enum)
	const semanticFixed = semanticMatchEnums(data, schema);
	allRepairs.push(...semanticFixed.repairs);
	data = semanticFixed.data;

	// Layer 5: Default injection
	const defaulted = injectDefaults(data, schema);
	allRepairs.push(...defaulted.repairs);
	data = defaulted.data;

	// Try parsing
	const parseResult = schema.safeParse(data);
	if (parseResult.success) {
		return { ok: true, data: parseResult.data, repairs: allRepairs };
	}

	// Layer 6: AI repair (opt-in, async)
	if (options?.repairModel) {
		const model = options.repairModel;
		return (async (): Promise<RepairResult> => {
			const aiResult = await aiRepair(
				data,
				schema,
				model,
				options.toolName ?? "unknown",
			);
			if (aiResult) {
				const reparse = schema.safeParse(aiResult.data);
				if (reparse.success) {
					allRepairs.push(...aiResult.repairs);
					return { ok: true, data: reparse.data, repairs: allRepairs };
				}
			}

			// Layer 7: Structured error
			return {
				ok: false,
				error: buildStructuredError(
					options.toolName ?? "unknown",
					data,
					schema,
					options.availableTools ?? [],
				),
			};
		})();
	}

	// Layer 7: Structured error (sync path)
	return {
		ok: false,
		error: buildStructuredError(
			options?.toolName ?? "unknown",
			data,
			schema,
			options?.availableTools ?? [],
		),
	};
}
