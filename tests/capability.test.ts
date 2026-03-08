import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Capability, TurnContext } from "../src/capability.ts";
import { CapabilityRegistry } from "../src/capability.ts";
import type { ToolDef } from "../src/types.ts";

function makeTool(desc: string, priority?: number): ToolDef {
	return {
		description: desc,
		category: "task",
		visibility: "always",
		schema: z.object({ id: z.string() }),
		execute: async () => ({ ok: true }),
		priority: priority ?? 0,
	};
}

const baseCtx: TurnContext = {
	state: "initial",
	activeHandles: [],
	turnNumber: 1,
	lastToolCalled: null,
};

describe("CapabilityRegistry", () => {
	test("register and retrieve", () => {
		const reg = new CapabilityRegistry();
		const cap: Capability = {
			name: "search",
			domain: "retail",
			group: "discover",
			tool: makeTool("Search products"),
			activationRules: [{ type: "always", condition: () => true }],
		};
		reg.register(cap);
		expect(reg.size()).toBe(1);
		expect(reg.getAll()).toHaveLength(1);
		expect(reg.getAll()[0]?.name).toBe("search");
		expect(reg.getAll()[0]?.domain).toBe("retail");
		expect(reg.getAll()[0]?.group).toBe("discover");
	});

	test("registerFromToolDef creates capability with defaults", () => {
		const reg = new CapabilityRegistry();
		const tool = makeTool("Browse products");
		reg.registerFromToolDef("browse", tool, {
			domain: "retail",
			group: "discover",
		});
		expect(reg.size()).toBe(1);
		const caps = reg.getAll();
		expect(caps[0]?.name).toBe("browse");
		expect(caps[0]?.domain).toBe("retail");
		expect(caps[0]?.group).toBe("discover");
		expect(caps[0]?.activationRules).toHaveLength(1);
		expect(caps[0]?.activationRules[0]?.type).toBe("always");
		// Default rule should return true
		expect(caps[0]?.activationRules[0]?.condition(baseCtx)).toBe(true);
	});

	test("fromToolDefs bulk converts", () => {
		const tools = {
			search: makeTool("Search"),
			browse: makeTool("Browse"),
			filter: makeTool("Filter"),
			details: makeTool("Details"),
			compare: makeTool("Compare"),
		};
		const domainMap = {
			search: { domain: "retail", group: "discover" },
			browse: { domain: "retail", group: "discover" },
			filter: {
				domain: "retail",
				group: "refine",
				activationRules: [
					{
						type: "state_match" as const,
						condition: (ctx: TurnContext) => ctx.state === "results",
					},
				],
			},
		};
		const reg = CapabilityRegistry.fromToolDefs(tools, domainMap);
		expect(reg.size()).toBe(5);

		// Mapped tools have correct domain
		const retail = reg.getByDomain("retail");
		expect(retail).toHaveLength(3);

		// Unmapped tools get domain="default"
		const defaults = reg.getByDomain("default");
		expect(defaults).toHaveLength(2);
		const defaultNames = defaults.map((c) => c.name).sort();
		expect(defaultNames).toEqual(["compare", "details"]);

		// Unmapped tools get group="default"
		const defaultGroup = reg.getByGroup("default");
		expect(defaultGroup).toHaveLength(2);

		// Unmapped tools are always active
		expect(reg.getActive(baseCtx).map((c) => c.name)).toContain("details");
		expect(reg.getActive(baseCtx).map((c) => c.name)).toContain("compare");

		// Mapped tool with custom activation rule is filtered correctly
		const filterCap = reg.getAll().find((c) => c.name === "filter");
		expect(filterCap?.activationRules[0]?.type).toBe("state_match");
		expect(
			reg
				.getActive(baseCtx)
				.map((c) => c.name)
				.includes("filter"),
		).toBe(false);
		expect(
			reg
				.getActive({ ...baseCtx, state: "results" })
				.map((c) => c.name)
				.includes("filter"),
		).toBe(true);
	});

	test("getActive filters by activation rules", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "browse",
			domain: "retail",
			group: "discover",
			tool: makeTool("Browse products"),
			activationRules: [{ type: "always", condition: () => true }],
		});
		reg.register({
			name: "checkout",
			domain: "retail",
			group: "purchase",
			tool: makeTool("Checkout"),
			activationRules: [
				{
					type: "state_match",
					condition: (ctx) => ctx.state === "cart_active",
				},
			],
		});

		// In "initial" state: only browse is active
		const initialActive = reg.getActive(baseCtx);
		expect(initialActive.map((c) => c.name)).toEqual(["browse"]);

		// In "cart_active" state: both active
		const cartActive = reg.getActive({ ...baseCtx, state: "cart_active" });
		expect(cartActive.map((c) => c.name)).toContain("browse");
		expect(cartActive.map((c) => c.name)).toContain("checkout");
		expect(cartActive).toHaveLength(2);
	});

	test("getActive sorts by priority descending", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "low_pri",
			domain: "d",
			group: "g",
			tool: makeTool("Low", 1),
			activationRules: [{ type: "always", condition: () => true }],
		});
		reg.register({
			name: "high_pri",
			domain: "d",
			group: "g",
			tool: makeTool("High", 10),
			activationRules: [{ type: "always", condition: () => true }],
		});
		reg.register({
			name: "mid_pri",
			domain: "d",
			group: "g",
			tool: makeTool("Mid", 5),
			activationRules: [{ type: "always", condition: () => true }],
		});
		const active = reg.getActive(baseCtx);
		expect(active[0]?.name).toBe("high_pri");
		expect(active[1]?.name).toBe("mid_pri");
		expect(active[2]?.name).toBe("low_pri");
	});

	test("getByDomain filters correctly", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "a",
			domain: "retail",
			group: "g1",
			tool: makeTool("A"),
			activationRules: [],
		});
		reg.register({
			name: "b",
			domain: "finance",
			group: "g1",
			tool: makeTool("B"),
			activationRules: [],
		});
		reg.register({
			name: "c",
			domain: "retail",
			group: "g2",
			tool: makeTool("C"),
			activationRules: [],
		});
		const retail = reg.getByDomain("retail");
		expect(retail).toHaveLength(2);
		expect(retail.map((c) => c.name).sort()).toEqual(["a", "c"]);

		const finance = reg.getByDomain("finance");
		expect(finance).toHaveLength(1);
		expect(finance[0]?.name).toBe("b");

		expect(reg.getByDomain("nonexistent")).toHaveLength(0);
	});

	test("getByGroup filters correctly", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "a",
			domain: "d1",
			group: "search",
			tool: makeTool("A"),
			activationRules: [],
		});
		reg.register({
			name: "b",
			domain: "d2",
			group: "search",
			tool: makeTool("B"),
			activationRules: [],
		});
		reg.register({
			name: "c",
			domain: "d1",
			group: "action",
			tool: makeTool("C"),
			activationRules: [],
		});
		const search = reg.getByGroup("search");
		expect(search).toHaveLength(2);
		expect(search.map((c) => c.name).sort()).toEqual(["a", "b"]);

		const action = reg.getByGroup("action");
		expect(action).toHaveLength(1);
		expect(action[0]?.name).toBe("c");

		expect(reg.getByGroup("nonexistent")).toHaveLength(0);
	});

	test("register replaces existing capability with same name", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "a",
			domain: "d1",
			group: "g",
			tool: makeTool("first"),
			activationRules: [],
		});
		reg.register({
			name: "a",
			domain: "d2",
			group: "g",
			tool: makeTool("second"),
			activationRules: [],
		});
		expect(reg.size()).toBe(1);
		expect(reg.getAll()[0]?.domain).toBe("d2");
		expect(reg.getAll()[0]?.tool.description).toBe("second");
	});

	test("handle_present activation rule", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "refine",
			domain: "retail",
			group: "search",
			tool: makeTool("Refine search"),
			activationRules: [
				{
					type: "handle_present",
					condition: (ctx) => ctx.activeHandles.length > 0,
				},
			],
		});
		expect(reg.getActive(baseCtx)).toHaveLength(0);
		expect(
			reg.getActive({ ...baseCtx, activeHandles: ["result_set_1"] }),
		).toHaveLength(1);
		expect(
			reg.getActive({ ...baseCtx, activeHandles: ["result_set_1"] })[0]?.name,
		).toBe("refine");
	});

	test("never activation rule always excludes", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "disabled",
			domain: "d",
			group: "g",
			tool: makeTool("Disabled"),
			activationRules: [{ type: "never", condition: () => false }],
		});
		expect(reg.getActive(baseCtx)).toHaveLength(0);
		expect(reg.getActive({ ...baseCtx, state: "any_state" })).toHaveLength(0);
		expect(
			reg.getActive({
				...baseCtx,
				activeHandles: ["h1"],
				turnNumber: 100,
			}),
		).toHaveLength(0);
	});

	test("empty activationRules means never active", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "no_rules",
			domain: "d",
			group: "g",
			tool: makeTool("No rules"),
			activationRules: [],
		});
		expect(reg.getActive(baseCtx)).toHaveLength(0);
		expect(reg.size()).toBe(1);
		// Still retrievable via getAll
		expect(reg.getAll()).toHaveLength(1);
		expect(reg.getAll()[0]?.name).toBe("no_rules");
	});

	test("multiple activation rules — any true makes capability active", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "multi",
			domain: "d",
			group: "g",
			tool: makeTool("Multi-rule"),
			activationRules: [
				{
					type: "state_match",
					condition: (ctx) => ctx.state === "special",
				},
				{
					type: "handle_present",
					condition: (ctx) => ctx.activeHandles.includes("magic"),
				},
			],
		});
		// Neither condition met
		expect(reg.getActive(baseCtx)).toHaveLength(0);
		// First condition met
		expect(reg.getActive({ ...baseCtx, state: "special" })).toHaveLength(1);
		// Second condition met
		expect(
			reg.getActive({ ...baseCtx, activeHandles: ["magic"] }),
		).toHaveLength(1);
		// Both met
		expect(
			reg.getActive({
				...baseCtx,
				state: "special",
				activeHandles: ["magic"],
			}),
		).toHaveLength(1);
	});

	test("getAll returns a copy, not the internal array", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "a",
			domain: "d",
			group: "g",
			tool: makeTool("A"),
			activationRules: [],
		});
		const all = reg.getAll();
		all.push({
			name: "injected",
			domain: "x",
			group: "x",
			tool: makeTool("X"),
			activationRules: [],
		});
		expect(reg.size()).toBe(1);
	});

	test("stable sort preserves insertion order for equal priority", () => {
		const reg = new CapabilityRegistry();
		reg.register({
			name: "first",
			domain: "d",
			group: "g",
			tool: makeTool("First", 5),
			activationRules: [{ type: "always", condition: () => true }],
		});
		reg.register({
			name: "second",
			domain: "d",
			group: "g",
			tool: makeTool("Second", 5),
			activationRules: [{ type: "always", condition: () => true }],
		});
		reg.register({
			name: "third",
			domain: "d",
			group: "g",
			tool: makeTool("Third", 5),
			activationRules: [{ type: "always", condition: () => true }],
		});
		const active = reg.getActive(baseCtx);
		expect(active.map((c) => c.name)).toEqual(["first", "second", "third"]);
	});
});
