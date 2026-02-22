import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { generatePromptBlock } from "../src/describe/prompt-block.ts";
import { toolSignature } from "../src/describe/signature.ts";
import { toolDetail } from "../src/describe/tool-detail.ts";
import type { ToolDef } from "../src/types.ts";

function makeTool(overrides: Partial<ToolDef> = {}): ToolDef {
	return {
		description: "Test tool.",
		category: "task",
		visibility: "always",
		schema: z.object({}),
		execute: async () => "ok",
		...overrides,
	};
}

describe("toolSignature", () => {
	test("required + optional params", () => {
		const tool = makeTool({
			description: "Send an email.",
			schema: z.object({
				to: z.string(),
				subject: z.string(),
				body: z.string(),
				cc: z.string().optional(),
				priority: z.enum(["low", "high"]).default("low"),
			}),
		});
		const sig = toolSignature("send_email", tool);
		expect(sig).toBe(
			'send_email(to, subject, body, cc?, priority?:low|high="low") -- Send an email.',
		);
	});

	test("no params", () => {
		const tool = makeTool({ description: "List items." });
		expect(toolSignature("list", tool)).toBe("list() -- List items.");
	});

	test("only optional params", () => {
		const tool = makeTool({
			description: "Search.",
			schema: z.object({
				q: z.string().optional(),
				limit: z.number().default(10),
			}),
		});
		expect(toolSignature("search", tool)).toBe(
			"search(q?, limit?:num=10) -- Search.",
		);
	});
});

describe("toolDetail", () => {
	test("includes typed signature and sections", () => {
		const tool = makeTool({
			description: "Send email to recipients.",
			schema: z.object({
				to: z.array(z.string()).describe("Recipients"),
				subject: z.string(),
				priority: z.enum(["low", "normal", "high"]).default("normal"),
			}),
		});
		const detail = toolDetail("send_email", tool);
		expect(detail).toContain("send_email");
		expect(detail).toContain("Required:");
		expect(detail).toContain("Optional:");
		expect(detail).toContain("Example:");
	});
});

describe("generatePromptBlock", () => {
	test("always tools in Core Tools", () => {
		const tools = [{ name: "read", tool: makeTool({ visibility: "always" }) }];
		const block = generatePromptBlock(tools);
		expect(block).toContain("### Core Tools");
		expect(block).toContain("read()");
	});

	test("listed tools in Additional Tools", () => {
		const tools = [{ name: "rare", tool: makeTool({ visibility: "listed" }) }];
		const block = generatePromptBlock(tools);
		expect(block).toContain("### Additional Tools");
		expect(block).toContain("rare() -- Test tool.");
	});

	test("hidden tools not shown", () => {
		const tools = [
			{ name: "secret", tool: makeTool({ visibility: "hidden" }) },
		];
		const block = generatePromptBlock(tools);
		expect(block).not.toContain("secret --");
		expect(block).toContain("1 additional tool(s) available");
	});
});
