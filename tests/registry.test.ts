import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ToolRegistry } from "../src/registry.ts";
import type { ToolDef } from "../src/types.ts";

function makeTool(overrides: Partial<ToolDef> = {}): ToolDef {
	return {
		description: "Test tool",
		category: "task",
		visibility: "always",
		schema: z.object({}),
		execute: async () => "ok",
		...overrides,
	};
}

describe("ToolRegistry", () => {
	describe("resolve", () => {
		test("exact match", () => {
			const reg = new ToolRegistry();
			reg.register("send_email", makeTool());
			const resolved = reg.resolve("send_email");
			expect(resolved?.name).toBe("send_email");
		});

		test("case-insensitive", () => {
			const reg = new ToolRegistry();
			reg.register("send_email", makeTool());
			expect(reg.resolve("Send_Email")?.name).toBe("send_email");
		});

		test("dot/underscore normalization", () => {
			const reg = new ToolRegistry();
			reg.register("worker.new", makeTool());
			expect(reg.resolve("worker_new")?.name).toBe("worker.new");
		});

		test("prefix match (unique)", () => {
			const reg = new ToolRegistry();
			reg.register("send_email", makeTool());
			reg.register("get_weather", makeTool());
			expect(reg.resolve("send_e")?.name).toBe("send_email");
		});

		test("Levenshtein fuzzy match", () => {
			const reg = new ToolRegistry();
			reg.register("send_email", makeTool());
			expect(reg.resolve("send_emal")?.name).toBe("send_email");
		});

		test("no match returns null", () => {
			const reg = new ToolRegistry();
			reg.register("send_email", makeTool());
			expect(reg.resolve("totally_unknown")).toBeNull();
		});
	});

	describe("list", () => {
		test("filters by category", () => {
			const reg = new ToolRegistry();
			reg.register("read_file", makeTool({ category: "read" }));
			reg.register("send_msg", makeTool({ category: "task" }));
			expect(reg.list("task").map((e) => e.name)).toEqual(["send_msg"]);
		});

		test("returns all without filter", () => {
			const reg = new ToolRegistry();
			reg.register("a", makeTool());
			reg.register("b", makeTool({ category: "read" }));
			expect(reg.list()).toHaveLength(2);
		});

		test("higher priority first", () => {
			const reg = new ToolRegistry();
			reg.register("low", makeTool({ priority: 1 }));
			reg.register("high", makeTool({ priority: 10 }));
			const names = reg.list().map((e) => e.name);
			expect(names[0]).toBe("high");
		});

		test("same priority preserves insertion order", () => {
			const reg = new ToolRegistry();
			reg.register("first", makeTool());
			reg.register("second", makeTool());
			const names = reg.list().map((e) => e.name);
			expect(names).toEqual(["first", "second"]);
		});
	});

	describe("lifecycle", () => {
		test("register makes tool resolvable", () => {
			const reg = new ToolRegistry();
			expect(reg.has("test")).toBe(false);
			reg.register("test", makeTool());
			expect(reg.has("test")).toBe(true);
		});

		test("unregister removes tool", () => {
			const reg = new ToolRegistry();
			reg.register("test", makeTool());
			reg.unregister("test");
			expect(reg.has("test")).toBe(false);
			expect(reg.resolve("test")).toBeNull();
		});

		test("re-register updates definition", () => {
			const reg = new ToolRegistry();
			reg.register("test", makeTool({ description: "v1" }));
			reg.register("test", makeTool({ description: "v2" }));
			expect(reg.get("test")?.description).toBe("v2");
			expect(reg.list()).toHaveLength(1);
		});
	});
});
