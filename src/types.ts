import type { LanguageModel } from "ai";
import type { z } from "zod";

export type Visibility = "always" | "listed" | "hidden";
export type Category = "read" | "search" | "task";

// biome-ignore lint/suspicious/noExplicitAny: generic defaults require any for flexibility
export interface ToolDef<TInput = any, TOutput = any> {
	description: string;
	category: Category;
	visibility: Visibility;
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>;
	execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>;
	examples?: TInput[];
	priority?: number;
	toModelOutput?: (opts: { output: TOutput }) => {
		type: "text";
		value: string;
	};
}

export type ToolDefs = Record<string, ToolDef>;

export interface ToolExecutionContext {
	toolCallId: string;
	experimental_context?: unknown;
	[key: string]: unknown;
}

export type RepairStrategy = RepairAction["strategy"];

export interface RepairPolicy {
	mode: "never" | "on_validation_failure" | "always";
	enabledLayers?: RepairStrategy[];
	confidenceThreshold?: number;
}

export interface HarnessEvent {
	type:
		| "tool_offered"
		| "tool_called"
		| "tool_omitted"
		| "repair_triggered"
		| "repair_layer_used"
		| "repair_skipped"
		| "execution_success"
		| "execution_failure";
	timestamp: number;
	data: Record<string, unknown>;
}

export interface HarnessConfig {
	repairModel?: LanguageModel | undefined;
	repairPolicy?: RepairPolicy | undefined;
	onEvent?: ((event: HarnessEvent) => void) | undefined;
}

export type RepairResult<T = Record<string, unknown>> =
	| { ok: true; data: T; repairs: RepairAction[] }
	| { ok: false; error: StructuredToolError };

export interface RepairAction {
	field: string;
	original: unknown;
	repaired: unknown;
	strategy:
		| "json_fix"
		| "key_normalize"
		| "coerce"
		| "fuzzy_enum"
		| "synonym_enum"
		| "semantic_enum"
		| "default"
		| "ai_repair";
}

export interface StructuredToolError {
	toolName: string;
	resolvedTo?: string | undefined;
	issues: FieldIssue[];
	suggestion?: string | undefined;
	availableTools?: string[];
}

export interface FieldIssue {
	path: string;
	expected: string;
	received: string;
	candidates?: string[] | undefined;
}
