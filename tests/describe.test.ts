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
	test("always tools in Core Tools (minimal)", () => {
		const tools = [{ name: "read", tool: makeTool({ visibility: "always" }) }];
		const block = generatePromptBlock(tools, { style: "minimal" });
		expect(block).toContain("### Core Tools");
		expect(block).toContain("read()");
	});

	test("listed tools in Additional Tools (minimal)", () => {
		const tools = [{ name: "rare", tool: makeTool({ visibility: "listed" }) }];
		const block = generatePromptBlock(tools, { style: "minimal" });
		expect(block).toContain("### Additional Tools");
		expect(block).toContain("rare() -- Test tool.");
	});

	test("hidden tools not shown (minimal)", () => {
		const tools = [
			{ name: "secret", tool: makeTool({ visibility: "hidden" }) },
		];
		const block = generatePromptBlock(tools, { style: "minimal" });
		expect(block).not.toContain("secret --");
		expect(block).toContain("1 additional tool(s) available");
	});

	test("default style is grouped_with_breadth", () => {
		const tools = [{ name: "read", tool: makeTool({ visibility: "always" }) }];
		const block = generatePromptBlock(tools, {});
		expect(block).toContain("## Available Actions");
		expect(block).not.toContain("## Available Tools");
	});

	test("minimal style with empty options", () => {
		const tools = [{ name: "read", tool: makeTool({ visibility: "always" }) }];
		const block = generatePromptBlock(tools, { style: "minimal" });
		expect(block).toContain("### Core Tools");
		expect(block).toContain("read()");
	});
});

describe("toolSignature — array and object types", () => {
	test("string array field shows :str[]", () => {
		const tool = makeTool({
			description: "Send email.",
			schema: z.object({
				to: z.array(z.string()),
			}),
		});
		const sig = toolSignature("send_email", tool);
		expect(sig).toBe("send_email(to:str[]) -- Send email.");
	});

	test("number array field shows :num[]", () => {
		const tool = makeTool({
			description: "Set scores.",
			schema: z.object({
				scores: z.array(z.number()),
			}),
		});
		const sig = toolSignature("set_scores", tool);
		expect(sig).toBe("set_scores(scores:num[]) -- Set scores.");
	});

	test("enum array field shows :enum[]|vals", () => {
		const tool = makeTool({
			description: "Set tags.",
			schema: z.object({
				tags: z.array(z.enum(["a", "b", "c"])),
			}),
		});
		const sig = toolSignature("set_tags", tool);
		expect(sig).toBe("set_tags(tags:enum[]|a|b|c) -- Set tags.");
	});

	test("object field shows :object", () => {
		const tool = makeTool({
			description: "Create item.",
			schema: z.object({
				metadata: z.object({ key: z.string() }),
			}),
		});
		const sig = toolSignature("create_item", tool);
		expect(sig).toBe("create_item(metadata:object) -- Create item.");
	});

	test("optional array field shows ?:str[]", () => {
		const tool = makeTool({
			description: "Send email.",
			schema: z.object({
				cc: z.array(z.string()).optional(),
			}),
		});
		const sig = toolSignature("send_email", tool);
		expect(sig).toBe("send_email(cc?:str[]) -- Send email.");
	});
});

describe("generatePromptBlock — grouped style", () => {
	const searchTool = makeTool({
		description: "Search the catalog.",
		category: "search",
		schema: z.object({
			query: z.string(),
			category: z.enum(["shoes", "shirts"]).optional(),
		}),
	});
	const getProductTool = makeTool({
		description: "Get full product details.",
		category: "read",
		schema: z.object({
			product_id: z.string(),
		}),
	});
	const addToCartTool = makeTool({
		description: "Add item to cart.",
		category: "task",
		schema: z.object({
			product_id: z.string(),
			quantity: z.number().default(1).optional(),
		}),
	});

	const tools = [
		{ name: "search_products", tool: searchTool },
		{ name: "get_product", tool: getProductTool },
		{ name: "add_to_cart", tool: addToCartTool },
	];

	const domainGroups = {
		"Browse & Discover": ["search_products", "get_product"],
		Purchase: ["add_to_cart"],
	};

	test("grouped style uses domainGroups", () => {
		const block = generatePromptBlock(tools, {
			style: "grouped",
			domainGroups,
		});
		expect(block).toContain("## Available Actions");
		expect(block).toContain("### Browse & Discover");
		expect(block).toContain("### Purchase");
		expect(block).toContain("- search_products(");
		expect(block).toContain("- get_product(");
		expect(block).toContain("- add_to_cart(");
		expect(block).toContain("When the user wants to");
	});

	test("grouped style falls back to category when no domainGroups", () => {
		const block = generatePromptBlock(tools, { style: "grouped" });
		expect(block).toContain("## Available Actions");
		expect(block).toContain("### Search");
		expect(block).toContain("### Read");
		expect(block).toContain("### Task");
	});

	test("grouped style includes action guidance", () => {
		const block = generatePromptBlock(tools, {
			style: "grouped",
			domainGroups,
		});
		expect(block).toContain("## Action Guidance");
		expect(block).not.toContain("## When NOT to Call Tools");
	});

	test("grouped style does not include few-shot examples section", () => {
		const block = generatePromptBlock(tools, {
			style: "grouped",
			domainGroups,
		});
		expect(block).not.toContain("## Example Tool Calls");
	});

	test("grouped_with_examples includes usage patterns", () => {
		const block = generatePromptBlock(tools, {
			style: "grouped_with_examples",
			domainGroups,
			breadthExamples: {
				search_products: [
					{
						description: "Category browse",
						input: {
							query: "summer dresses",
							category: "dresses",
						},
					},
					{
						description: "Simple search",
						input: { query: "shoes" },
					},
				],
			},
		});
		expect(block).toContain("Usage patterns:");
		expect(block).toContain("Category browse: search_products(");
		expect(block).toContain('query="summer dresses"');
	});

	test("grouped_with_examples omits usage patterns for groups with no examples", () => {
		const block = generatePromptBlock(tools, {
			style: "grouped_with_examples",
			domainGroups,
			breadthExamples: {
				search_products: [
					{
						description: "Category browse",
						input: { query: "dresses" },
					},
				],
			},
		});
		// Purchase group should not have usage patterns
		const purchaseSection = block.split("### Purchase")[1] ?? "";
		const nextSection = purchaseSection.split("##")[0] ?? purchaseSection;
		expect(nextSection).not.toContain("Usage patterns:");
	});

	test("full style includes everything", () => {
		const block = generatePromptBlock(tools, {
			style: "full",
			domainGroups,
			breadthExamples: {
				search_products: [
					{
						description: "Category browse",
						input: { query: "dresses" },
					},
				],
			},
		});
		expect(block).toContain("## Available Actions");
		expect(block).toContain("### Browse & Discover");
		expect(block).toContain("Usage patterns:");
		expect(block).toContain("## Action Guidance");
	});
});
