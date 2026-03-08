import type { LanguageModel } from "ai";
import type { z } from "zod";
import type {
	HarnessEvent,
	RepairAction,
	RepairPolicy,
	RepairResult,
	RepairStrategy,
} from "../types.ts";
import { aiRepair } from "./ai-repair.ts";
import { injectDefaults } from "./defaults.ts";
import { fuzzyMatchEnums } from "./fuzzy-enum.ts";
import { normalizeKeys } from "./key-normalize.ts";
import { semanticMatchEnums } from "./semantic-enum.ts";
import { buildStructuredError } from "./structured-error.ts";
import { synonymMatchEnums } from "./synonym-table.ts";
import { coerceTypes } from "./type-coerce.ts";

export { repairJSON } from "./json-repair.ts";

type LayerDef = {
	name: string;
	strategies: RepairStrategy[];
	run: (
		data: Record<string, unknown>,
		// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
		schema: z.ZodObject<any>,
		schemaKeys: string[],
	) => { data: Record<string, unknown>; repairs: RepairAction[] };
};

const LAYERS: LayerDef[] = [
	{
		name: "key_normalize",
		strategies: ["key_normalize"],
		run: (data, _schema, schemaKeys) => normalizeKeys(data, schemaKeys),
	},
	{
		name: "coerce",
		strategies: ["coerce"],
		run: (data, schema) => coerceTypes(data, schema),
	},
	{
		name: "fuzzy_enum",
		strategies: ["fuzzy_enum"],
		run: (data, schema) => fuzzyMatchEnums(data, schema),
	},
	{
		name: "synonym_enum",
		strategies: ["synonym_enum"],
		run: (data, schema) => synonymMatchEnums(data, schema),
	},
	{
		name: "semantic_enum",
		strategies: ["semantic_enum"],
		run: (data, schema) => semanticMatchEnums(data, schema),
	},
	{
		name: "default",
		strategies: ["default"],
		run: (data, schema) => injectDefaults(data, schema),
	},
];

function isLayerEnabled(
	layer: LayerDef,
	enabledLayers: RepairStrategy[] | undefined,
): boolean {
	if (!enabledLayers) return true;
	return layer.strategies.some((s) => enabledLayers.includes(s));
}

export function repairArgs(
	args: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
	options?: {
		repairModel?: LanguageModel | undefined;
		toolName?: string | undefined;
		availableTools?: string[] | undefined;
		repairPolicy?: RepairPolicy | undefined;
		onEvent?: ((event: HarnessEvent) => void) | undefined;
	},
): RepairResult | Promise<RepairResult> {
	const policy: RepairPolicy = options?.repairPolicy ?? {
		mode: "on_validation_failure",
	};
	const onEvent = options?.onEvent;

	// Mode: never — validate only, no repairs
	if (policy.mode === "never") {
		const parseResult = schema.safeParse(args);
		if (parseResult.success) {
			return { ok: true, data: parseResult.data, repairs: [] };
		}
		return {
			ok: false,
			error: buildStructuredError(
				options?.toolName ?? "unknown",
				args,
				schema,
				options?.availableTools ?? [],
			),
		};
	}

	// Mode: on_validation_failure — validate first, only repair if invalid
	if (policy.mode === "on_validation_failure") {
		const earlyParse = schema.safeParse(args);
		if (earlyParse.success) {
			onEvent?.({
				type: "repair_skipped",
				timestamp: Date.now(),
				data: { reason: "input_already_valid" },
			});
			return { ok: true, data: earlyParse.data, repairs: [] };
		}
	}

	// Mode: always (default) or on_validation_failure with invalid input — run pipeline
	return runPipeline(args, schema, policy, onEvent, options);
}

function runPipeline(
	args: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
	policy: RepairPolicy,
	onEvent: ((event: HarnessEvent) => void) | undefined,
	options?: {
		repairModel?: LanguageModel | undefined;
		toolName?: string | undefined;
		availableTools?: string[] | undefined;
		repairPolicy?: RepairPolicy | undefined;
		onEvent?: ((event: HarnessEvent) => void) | undefined;
	},
): RepairResult | Promise<RepairResult> {
	const allRepairs: RepairAction[] = [];
	const schemaKeys = Object.keys(schema.shape as Record<string, unknown>);
	let data = { ...args };

	for (const layer of LAYERS) {
		if (!isLayerEnabled(layer, policy.enabledLayers)) {
			onEvent?.({
				type: "repair_skipped",
				timestamp: Date.now(),
				data: { layer: layer.name, reason: "disabled_by_policy" },
			});
			continue;
		}

		const result = layer.run(data, schema, schemaKeys);
		if (result.repairs.length > 0) {
			onEvent?.({
				type: "repair_layer_used",
				timestamp: Date.now(),
				data: { layer: layer.name, repairCount: result.repairs.length },
			});
		}
		allRepairs.push(...result.repairs);
		data = result.data;
	}

	// Try parsing
	const parseResult = schema.safeParse(data);
	if (parseResult.success) {
		return { ok: true, data: parseResult.data, repairs: allRepairs };
	}

	// Layer 6: AI repair (opt-in, async)
	if (
		options?.repairModel &&
		isLayerEnabled(
			{
				name: "ai_repair",
				strategies: ["ai_repair"],
				run: () => ({ data: {}, repairs: [] }),
			},
			policy.enabledLayers,
		)
	) {
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
					onEvent?.({
						type: "repair_layer_used",
						timestamp: Date.now(),
						data: { layer: "ai_repair", repairCount: aiResult.repairs.length },
					});
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
