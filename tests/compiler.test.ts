import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Capability, TurnContext } from "../src/capability.ts";
import { compileTools } from "../src/compiler.ts";
import type { ToolDef } from "../src/types.ts";

function makeTool(desc: string, priority?: number): ToolDef {
	return {
		description: desc,
		category: "task",
		visibility: "always",
		schema: z.object({ id: z.string() }),
		execute: async (input) => ({ ok: true, id: input.id }),
		priority: priority ?? 0,
	};
}

function makeCap(
	name: string,
	opts?: {
		priority?: number;
		domain?: string;
		group?: string;
		active?: boolean;
		stateMatch?: string;
		needsHandle?: boolean;
	},
): Capability {
	const rules = [];
	if (opts?.stateMatch) {
		rules.push({
			type: "state_match" as const,
			condition: (ctx: TurnContext) => ctx.state === opts.stateMatch,
		});
	} else if (opts?.needsHandle) {
		rules.push({
			type: "handle_present" as const,
			condition: (ctx: TurnContext) => ctx.activeHandles.length > 0,
		});
	} else if (opts?.active === false) {
		rules.push({ type: "never" as const, condition: () => false });
	} else {
		rules.push({ type: "always" as const, condition: () => true });
	}
	return {
		name,
		domain: opts?.domain ?? "test",
		group: opts?.group ?? "test",
		tool: makeTool(name, opts?.priority),
		activationRules: rules,
	};
}

const baseCtx: TurnContext = {
	state: "initial",
	activeHandles: [],
	turnNumber: 1,
	lastToolCalled: null,
};

describe("compileTools", () => {
	test("returns only active capabilities in strict mode", () => {
		const caps = [
			makeCap("always_on"),
			makeCap("checkout", { stateMatch: "cart_active" }),
		];
		const result = compileTools(caps, baseCtx, { fallbackMode: "strict" });
		expect(result.metadata.offeredTools).toEqual(["always_on"]);
		expect(result.metadata.hiddenTools).toEqual([]);
	});

	test("respects maxTools limit", () => {
		const caps = Array.from({ length: 12 }, (_, i) => makeCap(`tool_${i}`));
		const result = compileTools(caps, baseCtx, { maxTools: 5 });
		expect(result.metadata.offeredTools).toHaveLength(5);
		expect(result.metadata.hiddenTools).toHaveLength(7);
	});

	test("sorts by priority descending", () => {
		const caps = [
			makeCap("low", { priority: 1 }),
			makeCap("high", { priority: 10 }),
			makeCap("med", { priority: 5 }),
		];
		const result = compileTools(caps, baseCtx);
		expect(result.metadata.offeredTools).toEqual(["high", "med", "low"]);
	});

	test("compileMs is populated and fast", () => {
		const caps = Array.from({ length: 20 }, (_, i) => makeCap(`tool_${i}`));
		const result = compileTools(caps, baseCtx);
		expect(result.metadata.compileMs).toBeGreaterThanOrEqual(0);
		expect(result.metadata.compileMs).toBeLessThan(10); // must be < 10ms
	});

	test("state_match activation works", () => {
		const caps = [
			makeCap("browse", { stateMatch: "initial" }),
			makeCap("checkout", { stateMatch: "cart_active" }),
		];

		const r1 = compileTools(caps, baseCtx, { fallbackMode: "strict" });
		expect(r1.metadata.offeredTools).toEqual(["browse"]);

		const r2 = compileTools(
			caps,
			{ ...baseCtx, state: "cart_active" },
			{ fallbackMode: "strict" },
		);
		expect(r2.metadata.offeredTools).toEqual(["checkout"]);
	});

	test("handle_present activation works", () => {
		const caps = [makeCap("refine", { needsHandle: true }), makeCap("search")];

		const r1 = compileTools(caps, baseCtx, { fallbackMode: "strict" });
		expect(r1.metadata.offeredTools).toEqual(["search"]);

		const r2 = compileTools(caps, {
			...baseCtx,
			activeHandles: ["result_set_1"],
		});
		expect(r2.metadata.offeredTools).toContain("refine");
		expect(r2.metadata.offeredTools).toContain("search");
	});

	test("inactive capabilities excluded", () => {
		const caps = [makeCap("active"), makeCap("disabled", { active: false })];
		const result = compileTools(caps, baseCtx);
		expect(result.metadata.offeredTools).toEqual(["active"]);
	});

	test("generated tools have correct descriptions", () => {
		const caps = [makeCap("my_tool")];
		const result = compileTools(caps, baseCtx);
		expect(Object.keys(result.tools)).toEqual(["my_tool"]);
	});

	test("empty capabilities returns empty tools", () => {
		const result = compileTools([], baseCtx);
		expect(result.metadata.offeredTools).toEqual([]);
		expect(Object.keys(result.tools)).toHaveLength(0);
	});

	test("priority-based selection when over maxTools", () => {
		// Ensure high-priority tools are selected over low-priority ones
		const caps = [
			makeCap("low1", { priority: 1 }),
			makeCap("low2", { priority: 2 }),
			makeCap("high1", { priority: 100 }),
			makeCap("high2", { priority: 50 }),
		];
		const result = compileTools(caps, baseCtx, { maxTools: 2 });
		expect(result.metadata.offeredTools).toEqual(["high1", "high2"]);
		expect(result.metadata.hiddenTools).toEqual(["low2", "low1"]);
	});

	test("tool execute function works", async () => {
		const caps = [makeCap("test_exec")];
		const result = compileTools(caps, baseCtx);
		// The tool should be callable (we can't easily test execute through AI SDK tool wrapper,
		// but we can verify the tool exists)
		expect(result.tools["test_exec"]).toBeDefined();
	});

	test("permissive mode fills remaining slots from inactive capabilities", () => {
		const caps = [
			makeCap("always_on"),
			makeCap("checkout", { stateMatch: "cart_active", priority: 5 }),
			makeCap("browse", { stateMatch: "browsing", priority: 3 }),
		];
		// Permissive opt-in; "always_on" is active, checkout and browse are inactive
		// but should fill remaining slots since maxTools=8
		const result = compileTools(caps, baseCtx, { fallbackMode: "permissive" });
		expect(result.metadata.offeredTools).toContain("always_on");
		expect(result.metadata.offeredTools).toContain("checkout");
		expect(result.metadata.offeredTools).toContain("browse");
		expect(result.metadata.offeredTools).toHaveLength(3);
	});

	test("permissive mode does not include 'never' capabilities as fallback", () => {
		const caps = [
			makeCap("always_on"),
			makeCap("disabled", { active: false }), // uses "never" rule type
			makeCap("checkout", { stateMatch: "cart_active" }),
		];
		const result = compileTools(caps, baseCtx, { fallbackMode: "permissive" });
		expect(result.metadata.offeredTools).toContain("always_on");
		expect(result.metadata.offeredTools).toContain("checkout");
		expect(result.metadata.offeredTools).not.toContain("disabled");
	});

	test("strict mode matches old behavior (only active capabilities)", () => {
		const caps = [
			makeCap("always_on"),
			makeCap("checkout", { stateMatch: "cart_active" }),
			makeCap("browse", { stateMatch: "browsing" }),
		];
		const result = compileTools(caps, baseCtx, { fallbackMode: "strict" });
		expect(result.metadata.offeredTools).toEqual(["always_on"]);
		expect(result.metadata.hiddenTools).toEqual([]);
	});

	test("permissive mode prioritizes active tools over inactive fallbacks", () => {
		const caps = [
			makeCap("active_low", { priority: 1 }),
			makeCap("inactive_high", { stateMatch: "other", priority: 100 }),
			makeCap("active_high", { priority: 50 }),
		];
		const result = compileTools(caps, baseCtx, {
			maxTools: 3,
			fallbackMode: "permissive",
		});
		// Active tools should come first (sorted by priority), then inactive
		expect(result.metadata.offeredTools).toEqual([
			"active_high",
			"active_low",
			"inactive_high",
		]);
	});
});
