/**
 * Example 4: Agent Next (Shopping Agent) Tools
 *
 * Shows how the same harness supports a completely different
 * domain — e-commerce — with the same 3 meta-tools pattern.
 * Demonstrates show/async flags passed through as args,
 * toModelOutput for AI vs UI rendering, and skill-loaded tasks.
 */
import { z } from "zod";
import { createHarness, defineTools } from "tool-harness";

const tools = defineTools({
	// ── read: virtual filesystem ──
	"product.read": {
		description: "Read product details by ID.",
		category: "read",
		visibility: "always",
		schema: z.object({
			productId: z.string().describe("Product ID"),
			show: z.boolean().default(false).describe("Show product card to user"),
		}),
		execute: async ({ productId, show }) => ({
			id: productId,
			title: "Blue Linen Shirt",
			price: 89,
			sizes: ["S", "M", "L", "XL"],
			// show flag is in the result — UI layer reads it from stream.data
			_display: show ? { action: "open_pdp", productId } : undefined,
		}),
		// toModelOutput compresses the result for the AI
		toModelOutput: ({ output }) => ({
			type: "text" as const,
			value: `${output.title} — $${output.price} — Sizes: ${output.sizes.join(", ")}`,
		}),
	},

	"user.context": {
		description: "Read user preferences, recent purchases, VTO history.",
		category: "read",
		visibility: "always",
		schema: z.object({}),
		execute: async () => ({
			preferences: { style: "minimalist", budget: "50-150", size: "M" },
			recentPurchases: ["Navy Chinos", "White Sneakers"],
		}),
	},

	"brand.policies": {
		description: "Read brand policies (returns, shipping, etc).",
		category: "read",
		visibility: "listed",
		schema: z.object({
			section: z.string().optional().describe('"returns", "shipping", or omit for all'),
		}),
		execute: async ({ section }) => `Return policy: 30 days, free returns on all orders.`,
	},

	"state.cart": {
		description: "Read current cart contents.",
		category: "read",
		visibility: "listed",
		schema: z.object({
			show: z.boolean().default(false),
		}),
		execute: async ({ show }) => ({
			items: [{ title: "Linen Shirt", size: "M", qty: 1, price: 89 }],
			total: 89,
			_display: show ? { action: "open_cart_modal" } : undefined,
		}),
	},

	// ── search: product finding ──
	"product.search": {
		description: "Search products by text query.",
		category: "search",
		visibility: "always",
		schema: z.object({
			query: z.string().describe("Search query"),
			filters: z.object({
				category: z.string().optional(),
				minPrice: z.number().optional(),
				maxPrice: z.number().optional(),
				size: z.string().optional(),
			}).optional(),
			show: z.boolean().default(true),
		}),
		execute: async ({ query, filters, show }) => ({
			results: [
				{ pos: 1, id: "prod_123", title: "Linen Shirt", price: 89 },
				{ pos: 2, id: "prod_456", title: "Cotton Tee", price: 45 },
			],
			_display: show ? { action: "show_results" } : undefined,
		}),
	},

	"similar.search": {
		description: "Find visually or semantically similar products.",
		category: "search",
		visibility: "listed",
		schema: z.object({
			productId: z.string().describe("Seed product ID"),
			limit: z.number().default(6),
		}),
		execute: async ({ productId, limit }) => ({
			results: [{ pos: 1, id: "prod_789", title: "Similar Shirt", price: 79 }],
		}),
	},

	"pairings.search": {
		description: "Find complementary products (outfit building).",
		category: "search",
		visibility: "listed",
		schema: z.object({
			productId: z.string().describe("Seed product ID"),
			category: z.string().optional().describe("Target category for pairing"),
		}),
		execute: async ({ productId }) => ({
			results: [{ pos: 1, id: "prod_pair_1", title: "Navy Chinos", price: 95 }],
		}),
	},

	// ── task: cart operations ──
	add_to_cart: {
		description: "Add item to cart.",
		category: "task",
		visibility: "always",
		schema: z.object({
			productId: z.string(),
			variantId: z.string(),
			size: z.string(),
			quantity: z.number().default(1),
		}),
		execute: async (input) => ({
			added: true,
			cartTotal: 89,
			_display: { action: "cart_updated", productId: input.productId },
		}),
	},

	remove_from_cart: {
		description: "Remove item from cart.",
		category: "task",
		visibility: "listed",
		schema: z.object({ variantId: z.string() }),
		execute: async ({ variantId }) => ({ removed: true }),
	},

	update_cart_item: {
		description: "Change size or quantity of cart item.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			variantId: z.string(),
			size: z.string().optional(),
			quantity: z.number().optional(),
		}),
		execute: async (input) => ({ updated: true }),
	},

	checkout: {
		description: "Open checkout flow.",
		category: "task",
		visibility: "listed",
		schema: z.object({}),
		execute: async () => ({
			_display: { action: "open_checkout" },
			message: "Checkout opened.",
		}),
	},

	// ── task: async operations ──
	start_vto: {
		description: "Start virtual try-on (async, 10-30s).",
		category: "task",
		visibility: "listed",
		schema: z.object({
			productId: z.string(),
			variantId: z.string(),
		}),
		execute: async ({ productId, variantId }) => ({
			jobId: `vto_${Date.now()}`,
			status: "started",
			estimatedSeconds: 15,
			// async: true is just a signal to the durable execution engine
		}),
	},

	start_return: {
		description: "Initiate a return (async, browser automation).",
		category: "task",
		visibility: "listed",
		schema: z.object({
			orderId: z.string(),
			lineItemIds: z.array(z.string()),
		}),
		execute: async ({ orderId }) => ({
			jobId: `return_${Date.now()}`,
			status: "started",
		}),
	},

	// ── task: internal ──
	thinking: {
		description: "Private reasoning scratchpad.",
		category: "task",
		visibility: "listed",
		schema: z.object({ thought: z.string() }),
		execute: async ({ thought }) => thought,
	},

	update_results: {
		description: "Hide or reorder search results by position.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			hide: z.array(z.number()).optional(),
			reorder: z.array(z.number()).optional(),
		}),
		execute: async ({ hide, reorder }) => ({ updated: true }),
	},
});

const harness = createHarness(tools);

console.log("=== Agent Next System Prompt Block ===");
console.log(harness.generatePromptBlock());
console.log();

// Compare tool counts
console.log("=== Tool Count Comparison ===");
console.log(`Agent Next original design: 3 tools (read, search, task) with many sub-routes`);
console.log(`Through harness: 3 meta-tools, ${Object.keys(tools).length} registered implementations`);
console.log();

// Skill loading demo
console.log("=== Skill Loading ===");
harness.loadTools({
	apply_campaign: {
		description: "Apply campaign pricing or bundling.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			code: z.string(),
			cartId: z.string(),
		}),
		execute: async ({ code }) => ({ applied: true, discount: "15%" }),
	},
});
console.log("After loading campaign skill:");
console.log(harness.generatePromptBlock());
