import type { z } from "zod";
import { generateObjectExample, getFields } from "../introspect.ts";
import type { ToolDef } from "../types.ts";
import { toolSignature } from "./signature.ts";

export function toolDetail(name: string, def: ToolDef): string {
	const { required, optional } = getFields(def.schema);
	const lines: string[] = [];

	// Typed signature
	const sig = toolSignature(name, def);
	lines.push(sig);
	lines.push("");
	lines.push(def.description);

	// Required fields
	if (required.length > 0) {
		lines.push("");
		lines.push("Required:");
		for (const f of required) {
			let typeName = getTypeName(f.unwrapped);
			const enumVals = f.enumValues;
			if (enumVals) typeName = enumVals.map((v) => `"${v}"`).join("|");
			const desc = f.description ? ` — ${f.description}` : "";
			lines.push(`  ${f.name}: ${typeName}${desc}`);
		}
	}

	// Optional fields
	if (optional.length > 0) {
		lines.push("");
		lines.push("Optional:");
		for (const f of optional) {
			let typeName = getTypeName(f.unwrapped);
			const enumVals = f.enumValues;
			if (enumVals) typeName = enumVals.map((v) => `"${v}"`).join("|");
			const defaultStr = f.hasDefault
				? ` (default: ${JSON.stringify(f.defaultValue)})`
				: "";
			const desc = f.description ? ` — ${f.description}` : "";
			lines.push(`  ${f.name}: ${typeName}${defaultStr}${desc}`);
		}
	}

	// Example
	const example = def.examples?.[0] ?? generateObjectExample(def.schema);
	if (example && Object.keys(example as object).length > 0) {
		lines.push("");
		lines.push("Example:");
		const pairs = Object.entries(example as Record<string, unknown>)
			.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
			.join(", ");
		lines.push(`  ${name}(${pairs})`);
	}

	return lines.join("\n");
}

function getTypeName(schema: z.ZodType): string {
	const name = schema?.constructor?.name ?? "";
	if (name.includes("String")) return "string";
	if (name.includes("Number")) return "number";
	if (name.includes("Boolean")) return "boolean";
	if (name.includes("Array")) return "array";
	if (name.includes("Object")) return "object";
	if (name.includes("Enum")) return "enum";
	return "unknown";
}
