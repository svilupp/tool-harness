import { z } from "zod";

export function unwrapSchema(schema: z.ZodType): z.ZodType {
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
		return unwrapSchema(schema.unwrap() as z.ZodType);
	}
	if (schema instanceof z.ZodDefault) {
		return unwrapSchema(schema.unwrap() as z.ZodType);
	}
	return schema;
}

export interface FieldInfo {
	name: string;
	required: boolean;
	schema: z.ZodType;
	unwrapped: z.ZodType;
	description?: string;
	defaultValue?: unknown;
	hasDefault: boolean;
	enumValues?: string[] | undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
export function getFields(schema: z.ZodObject<any>): {
	required: FieldInfo[];
	optional: FieldInfo[];
} {
	const required: FieldInfo[] = [];
	const optional: FieldInfo[] = [];
	const shape = schema.shape as Record<string, z.ZodType>;

	for (const [name, fieldSchema] of Object.entries(shape)) {
		const unwrapped = unwrapSchema(fieldSchema);
		const isOpt =
			fieldSchema instanceof z.ZodOptional ||
			fieldSchema instanceof z.ZodDefault ||
			fieldSchema.isOptional();
		const hasDefault = fieldSchema instanceof z.ZodDefault;
		const desc = fieldSchema.description ?? unwrapped.description;
		const info: FieldInfo = {
			name,
			required: !isOpt,
			schema: fieldSchema,
			unwrapped,
			...(desc ? { description: desc } : {}),
			...(hasDefault
				? {
						defaultValue: (fieldSchema as z.ZodDefault<z.ZodType>)._def
							.defaultValue,
					}
				: {}),
			hasDefault,
			enumValues: getEnumValues(fieldSchema) ?? undefined,
		};
		if (isOpt) optional.push(info);
		else required.push(info);
	}

	return { required, optional };
}

export function getEnumValues(schema: z.ZodType): string[] | null {
	const unwrapped = unwrapSchema(schema);
	if (unwrapped instanceof z.ZodEnum) {
		return unwrapped.options as string[];
	}
	return null;
}

export function getDefault(schema: z.ZodType): unknown | undefined {
	if (schema instanceof z.ZodDefault) {
		return schema._def.defaultValue;
	}
	return undefined;
}

export function getDescription(schema: z.ZodType): string | undefined {
	return schema.description;
}

export function generateExample(schema: z.ZodType): unknown {
	const unwrapped = unwrapSchema(schema);

	if (unwrapped instanceof z.ZodString) return "example";
	if (unwrapped instanceof z.ZodNumber) return 0;
	if (unwrapped instanceof z.ZodBoolean) return true;
	if (unwrapped instanceof z.ZodEnum) return unwrapped.options[0];
	if (unwrapped instanceof z.ZodArray) return [];
	if (unwrapped instanceof z.ZodObject) return generateObjectExample(unwrapped);
	return undefined;
}

export function generateObjectExample(
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject generic requires shape type
	schema: z.ZodObject<any>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const { required } = getFields(schema);
	for (const field of required) {
		result[field.name] = generateExample(field.schema);
	}
	return result;
}
