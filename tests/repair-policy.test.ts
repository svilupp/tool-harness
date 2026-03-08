import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fuzzyMatchEnums } from "../src/repair/fuzzy-enum.ts";
import { repairArgs } from "../src/repair/index.ts";
import type { HarnessEvent, RepairResult } from "../src/types.ts";

describe("Repair policy: never", () => {
	const schema = z.object({
		name: z.string(),
		priority: z.enum(["low", "normal", "high"]).default("normal"),
	});

	test("valid input passes through", () => {
		const result = repairArgs({ name: "test", priority: "high" }, schema, {
			repairPolicy: { mode: "never" },
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["name"]).toBe("test");
			expect(result.data["priority"]).toBe("high");
			expect(result.repairs).toHaveLength(0);
		}
	});

	test("valid input with defaults applied by zod", () => {
		const result = repairArgs({ name: "test" }, schema, {
			repairPolicy: { mode: "never" },
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["priority"]).toBe("normal");
			expect(result.repairs).toHaveLength(0);
		}
	});

	test("invalid input returns error without repair", () => {
		const result = repairArgs({}, schema, {
			repairPolicy: { mode: "never" },
		}) as RepairResult;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	test("does NOT fix key typos when policy is never", () => {
		const result = repairArgs({ Naame: "test", priority: "high" }, schema, {
			repairPolicy: { mode: "never" },
		}) as RepairResult;
		expect(result.ok).toBe(false);
	});
});

describe("Repair policy: on_validation_failure", () => {
	const schema = z.object({
		name: z.string(),
		priority: z.enum(["low", "normal", "high"]).default("normal"),
	});

	test("valid input skips repair layers entirely", () => {
		const result = repairArgs({ name: "test", priority: "high" }, schema, {
			repairPolicy: { mode: "on_validation_failure" },
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.repairs).toHaveLength(0);
		}
	});

	test("valid input with defaults skips repair", () => {
		const result = repairArgs({ name: "test" }, schema, {
			repairPolicy: { mode: "on_validation_failure" },
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["priority"]).toBe("normal");
			expect(result.repairs).toHaveLength(0);
		}
	});

	test("invalid input runs repair and fixes it", () => {
		const result = repairArgs({ Naame: "test", priority: "hihg" }, schema, {
			repairPolicy: { mode: "on_validation_failure" },
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["name"]).toBe("test");
			expect(result.data["priority"]).toBe("high");
			expect(result.repairs.length).toBeGreaterThan(0);
		}
	});

	test("emits repair_skipped event for valid input", () => {
		const events: HarnessEvent[] = [];
		repairArgs({ name: "test", priority: "high" }, schema, {
			repairPolicy: { mode: "on_validation_failure" },
			onEvent: (e) => events.push(e),
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("repair_skipped");
		expect(events[0]?.data["reason"]).toBe("input_already_valid");
	});
});

describe("Repair policy: always", () => {
	const schema = z.object({
		name: z.string(),
		priority: z.enum(["low", "normal", "high"]).default("normal"),
	});

	test("runs all layers even on valid input", () => {
		const events: HarnessEvent[] = [];
		const result = repairArgs({ Name: "test" }, schema, {
			repairPolicy: { mode: "always" },
			onEvent: (e) => events.push(e),
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["name"]).toBe("test");
			// Key normalization + default injection should have run
			const layerEvents = events.filter((e) => e.type === "repair_layer_used");
			expect(layerEvents.length).toBeGreaterThan(0);
		}
	});
});

describe("Repair policy: enabledLayers", () => {
	const schema = z.object({
		count: z.number(),
		Name: z.string(),
	});

	test("skips disabled layers", () => {
		const events: HarnessEvent[] = [];
		// Input needs key normalization (name → Name) + type coercion (string → number)
		// Only enable coerce → key normalization should be skipped
		const result = repairArgs({ count: "42", Name: "test" }, schema, {
			repairPolicy: { mode: "always", enabledLayers: ["coerce"] },
			onEvent: (e) => events.push(e),
		}) as RepairResult;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["count"]).toBe(42);
		}
		const skippedEvents = events.filter(
			(e) =>
				e.type === "repair_skipped" &&
				e.data["reason"] === "disabled_by_policy",
		);
		expect(skippedEvents.length).toBeGreaterThan(0);
		const skippedLayers = skippedEvents.map((e) => e.data["layer"]);
		expect(skippedLayers).toContain("key_normalize");
	});

	test("enabled layers still run", () => {
		const events: HarnessEvent[] = [];
		const result = repairArgs({ count: "42", Name: "test" }, schema, {
			repairPolicy: {
				mode: "always",
				enabledLayers: ["coerce", "key_normalize"],
			},
			onEvent: (e) => events.push(e),
		}) as RepairResult;
		expect(result.ok).toBe(true);
		const usedEvents = events.filter((e) => e.type === "repair_layer_used");
		expect(usedEvents.length).toBeGreaterThan(0);
	});
});

describe("Fuzzy enum drift fix", () => {
	test("rejects 'cheapest' matching 'newest'", () => {
		const schema = z.object({
			sort: z.enum(["price_asc", "price_desc", "newest", "relevance"]),
		});
		const { data, repairs } = fuzzyMatchEnums({ sort: "cheapest" }, schema);
		// Should NOT match "newest" — no shared word overlap
		expect(data["sort"]).toBe("cheapest"); // unchanged
		expect(repairs).toHaveLength(0);
	});

	test("still matches valid typos like 'hihg' → 'high'", () => {
		const schema = z.object({
			priority: z.enum(["low", "normal", "high"]),
		});
		const { data, repairs } = fuzzyMatchEnums({ priority: "hihg" }, schema);
		expect(data["priority"]).toBe("high");
		expect(repairs).toHaveLength(1);
	});

	test("still matches case-insensitive", () => {
		const schema = z.object({
			priority: z.enum(["low", "normal", "high"]),
		});
		const { data, repairs } = fuzzyMatchEnums({ priority: "HIGH" }, schema);
		expect(data["priority"]).toBe("high");
		expect(repairs).toHaveLength(1);
	});

	test("still matches prefix", () => {
		const schema = z.object({
			priority: z.enum(["low", "normal", "high"]),
		});
		const { data, repairs } = fuzzyMatchEnums({ priority: "lo" }, schema);
		expect(data["priority"]).toBe("low");
		expect(repairs).toHaveLength(1);
	});

	test("rejects 'last month' matching 'this_month'", () => {
		const schema = z.object({
			period: z.enum(["this_month", "this_year", "all_time"]),
		});
		const { data, repairs } = fuzzyMatchEnums({ period: "last month" }, schema);
		// "last" and "this" share no word overlap
		expect(data["period"]).toBe("last month");
		expect(repairs).toHaveLength(0);
	});

	test("accepts 'priceasc' matching 'price_asc'", () => {
		const schema = z.object({
			sort: z.enum(["price_asc", "price_desc", "newest", "relevance"]),
		});
		const { data, repairs } = fuzzyMatchEnums({ sort: "priceasc" }, schema);
		// shares "price" substring
		expect(data["sort"]).toBe("price_asc");
		expect(repairs).toHaveLength(1);
	});
});

describe("Event emission", () => {
	test("onEvent receives repair_layer_used events", () => {
		const events: HarnessEvent[] = [];
		const schema = z.object({
			priority: z.enum(["low", "normal", "high"]).default("normal"),
		});
		repairArgs({ Priority: "hihg" }, schema, {
			repairPolicy: { mode: "always" },
			onEvent: (e) => events.push(e),
		});
		const layerUsed = events.filter((e) => e.type === "repair_layer_used");
		expect(layerUsed.length).toBeGreaterThan(0);
		// Should have key_normalize and fuzzy_enum at minimum
		const layers = layerUsed.map((e) => e.data["layer"]);
		expect(layers).toContain("key_normalize");
		expect(layers).toContain("fuzzy_enum");
	});

	test("onEvent receives repair_skipped for valid input with on_validation_failure", () => {
		const events: HarnessEvent[] = [];
		const schema = z.object({
			name: z.string(),
		});
		repairArgs({ name: "test" }, schema, {
			repairPolicy: { mode: "on_validation_failure" },
			onEvent: (e) => events.push(e),
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("repair_skipped");
		expect(events[0]?.data["reason"]).toBe("input_already_valid");
	});
});
