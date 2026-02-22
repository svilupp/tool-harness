import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { injectDefaults } from "../src/repair/defaults.ts";
import { fuzzyMatchEnums } from "../src/repair/fuzzy-enum.ts";
import { repairArgs } from "../src/repair/index.ts";
import { repairJSON } from "../src/repair/json-repair.ts";
import { normalizeKeys } from "../src/repair/key-normalize.ts";
import { semanticMatchEnums } from "../src/repair/semantic-enum.ts";
import { buildStructuredError } from "../src/repair/structured-error.ts";
import { coerceTypes } from "../src/repair/type-coerce.ts";
import type { RepairResult } from "../src/types.ts";

describe("Layer 1: JSON repair", () => {
	test("fixes trailing commas + single quotes", () => {
		const result = repairJSON(`{'to': ['a@b.com',], 'subject': "Hi",}`);
		expect(result?.data).toEqual({ to: ["a@b.com"], subject: "Hi" });
	});

	test("strips markdown fences", () => {
		const result = repairJSON('```json\n{"key": "value"}\n```');
		expect(result?.data).toEqual({ key: "value" });
	});

	test("extracts first object from array", () => {
		const result = repairJSON('[{"a":1}, {"b":2}]');
		expect(result?.data).toEqual({ a: 1 });
	});

	test("returns null for completely invalid", () => {
		expect(repairJSON("not json at all !!!")).toBeNull();
	});
});

describe("Layer 2: Key normalization", () => {
	test("case-insensitive match", () => {
		const { data } = normalizeKeys({ Subject: "Hi" }, ["subject"]);
		expect(data).toEqual({ subject: "Hi" });
	});

	test("camelCase to snake_case", () => {
		const { data } = normalizeKeys({ emailAddress: "a@b.com" }, [
			"email_address",
		]);
		expect(data).toEqual({ email_address: "a@b.com" });
	});

	test("Levenshtein fuzzy match", () => {
		const { data } = normalizeKeys({ boddy: "text" }, ["body"]);
		expect(data).toEqual({ body: "text" });
	});

	test("correct keys pass through", () => {
		const { data, repairs } = normalizeKeys({ name: "test" }, ["name"]);
		expect(data).toEqual({ name: "test" });
		expect(repairs).toHaveLength(0);
	});
});

describe("Layer 3: Type coercion", () => {
	const schema = z.object({
		count: z.number(),
		active: z.boolean(),
		tags: z.array(z.string()),
	});

	test("string to number", () => {
		const { data } = coerceTypes({ count: "42" }, schema);
		expect(data["count"]).toBe(42);
	});

	test("'true'/'false' to boolean", () => {
		const { data: d1 } = coerceTypes({ active: "true" }, schema);
		expect(d1["active"]).toBe(true);
		const { data: d2 } = coerceTypes({ active: "false" }, schema);
		expect(d2["active"]).toBe(false);
	});

	test("'yes'/'no' to boolean", () => {
		const { data } = coerceTypes({ active: "yes" }, schema);
		expect(data["active"]).toBe(true);
	});

	test("single value to array", () => {
		const { data } = coerceTypes({ tags: "single" }, schema);
		expect(data["tags"]).toEqual(["single"]);
	});

	test("empty string for number → undefined", () => {
		const { data } = coerceTypes({ count: "" }, schema);
		expect(data["count"]).toBeUndefined();
	});
});

describe("Layer 4: Fuzzy enum matching", () => {
	const schema = z.object({
		priority: z.enum(["low", "normal", "high"]),
	});

	test("case-insensitive", () => {
		const { data } = fuzzyMatchEnums({ priority: "HIGH" }, schema);
		expect(data["priority"]).toBe("high");
	});

	test("prefix match (unique)", () => {
		const { data } = fuzzyMatchEnums({ priority: "lo" }, schema);
		expect(data["priority"]).toBe("low");
	});

	test("Levenshtein fuzzy match", () => {
		const { data } = fuzzyMatchEnums({ priority: "hihg" }, schema);
		expect(data["priority"]).toBe("high");
	});

	test("valid value passes through", () => {
		const { data, repairs } = fuzzyMatchEnums({ priority: "high" }, schema);
		expect(data["priority"]).toBe("high");
		expect(repairs).toHaveLength(0);
	});
});

describe("Layer 4b: Semantic enum matching", () => {
	const schema = z.object({
		reason: z.enum([
			"found_better_price",
			"product_defective",
			"wrong_item",
			"changed_mind",
		]),
	});

	test("word overlap: natural language to snake_case", () => {
		const { data, repairs } = semanticMatchEnums(
			{ reason: "found a better price elsewhere" },
			schema,
		);
		expect(data["reason"]).toBe("found_better_price");
		expect(repairs).toHaveLength(1);
		expect(repairs[0]?.strategy).toBe("semantic_enum");
	});

	test("word overlap: reordered words still match", () => {
		const { data } = semanticMatchEnums(
			{ reason: "the item was wrong" },
			schema,
		);
		expect(data["reason"]).toBe("wrong_item");
	});

	test("substring containment: input contains enum phrase", () => {
		const statusSchema = z.object({
			status: z.enum([
				"payment_completed",
				"payment_pending",
				"payment_failed",
			]),
		});
		const { data, repairs } = semanticMatchEnums(
			{ status: "the payment completed successfully" },
			statusSchema,
		);
		expect(data["status"]).toBe("payment_completed");
		expect(repairs).toHaveLength(1);
	});

	test("substring containment: enum phrase contains input", () => {
		const statusSchema = z.object({
			status: z.enum([
				"payment_completed",
				"payment_pending",
				"payment_failed",
			]),
		});
		const { data } = semanticMatchEnums(
			{ status: "payment completed" },
			statusSchema,
		);
		expect(data["status"]).toBe("payment_completed");
	});

	test("abbreviation expansion: mem -> memory", () => {
		const tierSchema = z.object({
			tier: z.enum([
				"batch_high_mem_8gb_2cpu",
				"batch_low_mem_2gb_1cpu",
				"realtime_standard",
			]),
		});
		const { data, repairs } = semanticMatchEnums(
			{ tier: "high memory" },
			tierSchema,
		);
		expect(data["tier"]).toBe("batch_high_mem_8gb_2cpu");
		expect(repairs).toHaveLength(1);
	});

	test("normalize exact: underscore vs hyphen vs space", () => {
		const { data } = semanticMatchEnums(
			{ reason: "found-better-price" },
			schema,
		);
		expect(data["reason"]).toBe("found_better_price");
	});

	test("rejects ambiguous matches", () => {
		const ambiguousSchema = z.object({
			action: z.enum(["delete_user_data", "delete_user_account"]),
		});
		// "delete user" matches both equally -- should be rejected
		const { data, repairs } = semanticMatchEnums(
			{ action: "delete user" },
			ambiguousSchema,
		);
		// Should NOT repair since both options match similarly
		expect(repairs).toHaveLength(0);
		expect(data["action"]).toBe("delete user");
	});

	test("valid value passes through unchanged", () => {
		const { data, repairs } = semanticMatchEnums(
			{ reason: "found_better_price" },
			schema,
		);
		expect(data["reason"]).toBe("found_better_price");
		expect(repairs).toHaveLength(0);
	});

	test("skips non-enum fields", () => {
		const mixedSchema = z.object({
			name: z.string(),
			reason: z.enum(["found_better_price", "changed_mind"]),
		});
		const { data, repairs } = semanticMatchEnums(
			{ name: "test user", reason: "changed my mind" },
			mixedSchema,
		);
		expect(data["name"]).toBe("test user");
		expect(data["reason"]).toBe("changed_mind");
		expect(repairs).toHaveLength(1);
	});

	test("abbreviation expansion: db -> database", () => {
		const configSchema = z.object({
			backend: z.enum(["db_postgres", "db_mysql", "cache_redis"]),
		});
		const { data } = semanticMatchEnums(
			{ backend: "database postgres" },
			configSchema,
		);
		expect(data["backend"]).toBe("db_postgres");
	});
});

describe("Layer 5: Default injection", () => {
	const schema = z.object({
		name: z.string(),
		priority: z.enum(["low", "normal", "high"]).default("normal"),
		count: z.number().optional(),
	});

	test("injects default for missing field", () => {
		const { data } = injectDefaults({ name: "test" }, schema);
		expect(data["priority"]).toBe("normal");
	});

	test("does not overwrite present fields", () => {
		const { data } = injectDefaults({ name: "test", priority: "high" }, schema);
		expect(data["priority"]).toBe("high");
	});

	test("optional without default stays absent", () => {
		const { data } = injectDefaults({ name: "test" }, schema);
		expect(data["count"]).toBeUndefined();
	});
});

describe("Layer 7: Structured error", () => {
	test("builds error with field issues", () => {
		const schema = z.object({
			name: z.string(),
			priority: z.enum(["low", "high"]),
		});
		const error = buildStructuredError(
			"test",
			{ priority: "invalid" },
			schema,
			["test"],
		);
		expect(error.toolName).toBe("test");
		expect(error.issues.length).toBeGreaterThan(0);
		expect(error.suggestion).toBeDefined();
	});

	test("enum mismatch includes candidates", () => {
		const schema = z.object({
			priority: z.enum(["low", "high"]),
		});
		const error = buildStructuredError(
			"test",
			{ priority: "invalid" },
			schema,
			[],
		);
		const priorityIssue = error.issues.find((i) => i.path === "priority");
		expect(priorityIssue?.candidates).toEqual(["low", "high"]);
	});
});

describe("Full pipeline", () => {
	const schema = z.object({
		to: z.array(z.string()),
		subject: z.string(),
		body: z.string(),
		priority: z.enum(["low", "normal", "high"]).default("normal"),
	});

	test("combined repairs: wrong keys + string coercion + enum fix", () => {
		const result = repairArgs(
			{ To: "a@b.com", Subject: "Hi", Body: "Hello", Priority: "hgih" },
			schema,
		);
		expect(result).not.toBeInstanceOf(Promise);
		const r = result as Exclude<typeof result, Promise<RepairResult>>;
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.data["to"]).toEqual(["a@b.com"]);
			expect(r.data["priority"]).toBe("high");
			expect(r.repairs.length).toBeGreaterThan(0);
		}
	});

	test("valid input passes through with empty repairs", () => {
		const result = repairArgs(
			{ to: ["a@b.com"], subject: "Hi", body: "Hello" },
			schema,
		);
		const r = result as Exclude<typeof result, Promise<RepairResult>>;
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.repairs.filter((r) => r.strategy !== "default")).toHaveLength(0);
		}
	});

	test("completely invalid input returns error", () => {
		const strictSchema = z.object({
			required_field: z.string(),
		});
		const result = repairArgs({}, strictSchema);
		const r = result as Exclude<typeof result, Promise<RepairResult>>;
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.issues.length).toBeGreaterThan(0);
		}
	});
});
