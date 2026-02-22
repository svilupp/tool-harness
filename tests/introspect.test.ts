import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	generateObjectExample,
	getEnumValues,
	getFields,
	unwrapSchema,
} from "../src/introspect.ts";

describe("unwrapSchema", () => {
	test("unwraps ZodOptional", () => {
		const schema = z.string().optional();
		const unwrapped = unwrapSchema(schema);
		expect(unwrapped).toBeInstanceOf(z.ZodString);
	});

	test("unwraps ZodDefault", () => {
		const schema = z.number().default(5);
		const unwrapped = unwrapSchema(schema);
		expect(unwrapped).toBeInstanceOf(z.ZodNumber);
	});

	test("unwraps nullable + optional", () => {
		const schema = z.boolean().nullable().optional();
		const unwrapped = unwrapSchema(schema);
		expect(unwrapped).toBeInstanceOf(z.ZodBoolean);
	});

	test("returns plain schema as-is", () => {
		const schema = z.string();
		expect(unwrapSchema(schema)).toBe(schema);
	});
});

describe("getFields", () => {
	test("splits required and optional correctly", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
			email: z.string().optional(),
			role: z.string().default("user"),
		});
		const { required, optional } = getFields(schema);
		expect(required.map((f) => f.name)).toEqual(["name", "age"]);
		expect(optional.map((f) => f.name)).toEqual(["email", "role"]);
	});

	test("default fields classified as optional", () => {
		const schema = z.object({
			priority: z.enum(["low", "high"]).default("low"),
		});
		const { required, optional } = getFields(schema);
		expect(required).toHaveLength(0);
		expect(optional).toHaveLength(1);
		expect(optional[0]?.hasDefault).toBe(true);
		expect(optional[0]?.defaultValue).toBe("low");
	});

	test("empty schema returns empty arrays", () => {
		const schema = z.object({});
		const { required, optional } = getFields(schema);
		expect(required).toHaveLength(0);
		expect(optional).toHaveLength(0);
	});
});

describe("getEnumValues", () => {
	test("extracts enum values", () => {
		expect(getEnumValues(z.enum(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
	});

	test("extracts from wrapped enum", () => {
		const schema = z.enum(["x"]).optional().default("x");
		expect(getEnumValues(schema)).toEqual(["x"]);
	});

	test("returns null for non-enum", () => {
		expect(getEnumValues(z.string())).toBeNull();
	});
});

describe("generateObjectExample", () => {
	test("produces valid object for schema", () => {
		const schema = z.object({
			name: z.string(),
			count: z.number(),
			active: z.boolean(),
			tags: z.array(z.string()).optional(),
		});
		const example = generateObjectExample(schema);
		expect(example).toHaveProperty("name");
		expect(example).toHaveProperty("count");
		expect(example).toHaveProperty("active");
		// Required fields pass validation
		const result = schema.safeParse(example);
		expect(result.success).toBe(true);
	});

	test("enum fields use first value", () => {
		const schema = z.object({
			priority: z.enum(["low", "normal", "high"]),
		});
		const example = generateObjectExample(schema);
		expect(example["priority"]).toBe("low");
	});
});
