import type { z } from "zod";
import { getEnumValues } from "../introspect.ts";
import type { FieldIssue, StructuredToolError } from "../types.ts";

export function buildStructuredError(
	toolName: string,
	args: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
	availableTools: string[],
	resolvedTo?: string,
): StructuredToolError {
	const parseResult = schema.safeParse(args);
	const issues: FieldIssue[] = [];

	if (!parseResult.success) {
		for (const issue of parseResult.error.issues) {
			const pathStr = issue.path.join(".");
			// Resolve nested paths: walk into schema.shape for the top-level key
			const topKey = issue.path[0];
			const fieldSchema =
				typeof topKey === "string"
					? (schema.shape as Record<string, z.ZodType>)[topKey]
					: undefined;
			const enumVals = fieldSchema ? getEnumValues(fieldSchema) : null;

			// Resolve the actual value from args using the path segments
			let received: unknown = args;
			for (const segment of issue.path) {
				if (received != null && typeof received === "object") {
					received = (received as Record<string, unknown>)[String(segment)];
				} else {
					received = undefined;
					break;
				}
			}

			issues.push({
				path: pathStr || "(root)",
				expected: issue.message,
				received: String(received ?? "undefined"),
				candidates: enumVals ?? undefined,
			});
		}
	}

	const suggestion =
		issues.length > 0
			? `Fix ${issues.length} field(s): ${issues.map((i) => i.path).join(", ")}`
			: undefined;

	return {
		toolName,
		resolvedTo,
		issues,
		suggestion,
		availableTools,
	};
}
