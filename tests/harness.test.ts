import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createHarness, defineTools } from "../src/harness.ts";

const tools = defineTools({
	send_email: {
		description: "Send an email.",
		category: "task" as const,
		visibility: "always" as const,
		schema: z.object({
			to: z.array(z.string()),
			subject: z.string(),
			body: z.string(),
			priority: z.enum(["low", "normal", "high"]).default("normal"),
		}),
		examples: [{ to: ["a@b.com"], subject: "Hi", body: "Hello" }],
		execute: async (input: Record<string, unknown>) => ({
			sent: true,
			to: input["to"],
		}),
	},
	get_weather: {
		description: "Get weather.",
		category: "read" as const,
		visibility: "always" as const,
		schema: z.object({
			city: z.string(),
			units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
		}),
		execute: async (input: Record<string, unknown>) => ({
			city: input["city"],
			temp: 22,
		}),
	},
	search_docs: {
		description: "Search docs.",
		category: "search" as const,
		visibility: "always" as const,
		schema: z.object({
			query: z.string(),
			limit: z.number().default(5),
		}),
		execute: async (input: Record<string, unknown>) => ({
			results: [{ title: input["query"] }],
		}),
	},
});

describe("dispatch", () => {
	test("task dispatch calls correct tool", async () => {
		const harness = createHarness(tools);
		const result = await harness.dispatch("task", {
			name: "send_email",
			args: { to: ["a@b.com"], subject: "Hi", body: "Hello" },
		});
		expect(result).toEqual({ sent: true, to: ["a@b.com"] });
	});

	test("read('tools') returns summaries", async () => {
		const harness = createHarness(tools);
		const result = await harness.dispatch("read", { target: "tools" });
		expect(result).toContain("send_email");
		expect(result).toContain("get_weather");
	});

	test("read('tools/send_email') returns detail", async () => {
		const harness = createHarness(tools);
		const result = await harness.dispatch("read", {
			target: "tools/send_email",
		});
		expect(result).toContain("Send an email");
		expect(result).toContain("Required:");
	});

	test("search dispatch routes to search tool", async () => {
		const harness = createHarness(tools);
		const result = (await harness.dispatch("search", {
			query: "test",
		})) as Record<string, unknown>;
		expect(result["results"]).toBeDefined();
	});
});

describe("repair", () => {
	test("repairs key case + type coercion", async () => {
		const harness = createHarness(tools);
		const result = await harness.repair("send_email", {
			To: ["a@b.com"],
			Subject: "Hi",
			Body: "Hello",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data["to"]).toEqual(["a@b.com"]);
			expect(result.repairs.length).toBeGreaterThan(0);
		}
	});

	test("unknown tool returns error", async () => {
		const harness = createHarness(tools);
		const result = await harness.repair("unknown_tool", {});
		expect(result.ok).toBe(false);
	});
});

describe("dynamic tools", () => {
	test("loadTools makes tool dispatchable", async () => {
		const harness = createHarness(tools);
		harness.loadTools({
			new_task: {
				description: "New task.",
				category: "task",
				visibility: "listed",
				schema: z.object({ x: z.string() }),
				execute: async ({ x }) => ({ done: true, x }),
			},
		});
		const result = await harness.dispatch("task", {
			name: "new_task",
			args: { x: "test" },
		});
		expect(result).toEqual({ done: true, x: "test" });
	});

	test("prompt block includes loaded tool", () => {
		const harness = createHarness(tools);
		harness.loadTools({
			new_task: {
				description: "New task.",
				category: "task",
				visibility: "listed",
				schema: z.object({}),
				execute: async () => "ok",
			},
		});
		const block = harness.generatePromptBlock();
		expect(block).toContain("new_task");
	});

	test("unloadTools removes tool", async () => {
		const harness = createHarness(tools);
		harness.loadTools({
			temp: {
				description: "Temp.",
				category: "task",
				visibility: "always",
				schema: z.object({}),
				execute: async () => "ok",
			},
		});
		harness.unloadTools(["temp"]);
		const block = harness.generatePromptBlock();
		expect(block).not.toContain("temp");
	});
});

describe("SDK integration", () => {
	test("toMetaTools returns 3 tools", () => {
		const harness = createHarness(tools);
		const meta = harness.toMetaTools();
		expect(Object.keys(meta).sort()).toEqual(["read", "search", "task"]);
	});

	test("task tool description includes task signatures", () => {
		const harness = createHarness(tools);
		const meta = harness.toMetaTools();
		expect(meta.task.description).toContain("send_email");
	});

	test("toDirectTools returns all tools", () => {
		const harness = createHarness(tools);
		const direct = harness.toDirectTools();
		expect(Object.keys(direct).sort()).toEqual([
			"get_weather",
			"search_docs",
			"send_email",
		]);
	});

	test("direct tools with examples include inputExamples", () => {
		const harness = createHarness(tools);
		const direct = harness.toDirectTools();
		// send_email has examples, so inputExamples should be set
		// biome-ignore lint/suspicious/noExplicitAny: accessing AI SDK internal property for testing
		expect((direct["send_email"] as any).inputExamples).toBeDefined();
	});

	test("repairHook returns a function", () => {
		const harness = createHarness(tools);
		const hook = harness.repairHook();
		expect(typeof hook).toBe("function");
	});
});
