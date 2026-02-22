import { z } from "zod";
import { type FieldInfo, getFields, unwrapSchema } from "../introspect.ts";
import type { ToolDef } from "../types.ts";

const MAX_ENUM_DISPLAY = 6;

function formatParam(field: FieldInfo): string {
	const isOptional = !field.required;

	let result = field.name;
	if (isOptional) result += "?";

	// Determine type suffix and enum values
	const enumVals = field.enumValues;
	const innerType = unwrapSchema(field.schema);

	if (enumVals && enumVals.length > 0) {
		// Enum values: pipe-delimited
		let enumStr: string;
		if (enumVals.length > MAX_ENUM_DISPLAY) {
			enumStr = `${enumVals.slice(0, 5).join("|")}|...`;
		} else {
			enumStr = enumVals.join("|");
		}
		result += `:${enumStr}`;
	} else if (innerType instanceof z.ZodNumber) {
		result += ":num";
	} else if (innerType instanceof z.ZodBoolean) {
		result += ":bool";
	}
	// Strings are default type, no annotation needed

	// Default value
	if (field.hasDefault && field.defaultValue !== undefined) {
		const dv = field.defaultValue;
		if (typeof dv === "string") {
			result += `="${dv}"`;
		} else {
			result += `=${dv}`;
		}
	}

	return result;
}

export function toolSignature(name: string, def: ToolDef): string {
	const { required, optional } = getFields(def.schema);
	const allParams = [
		...required.map((f) => formatParam(f)),
		...optional.map((f) => formatParam(f)),
	];

	const params = allParams.join(", ");

	// Ensure description ends with a period
	let desc = def.description.trim();
	if (!desc.endsWith(".")) desc += ".";

	return `${name}(${params}) -- ${desc}`;
}
