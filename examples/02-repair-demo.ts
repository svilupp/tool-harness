/**
 * Example 2: Repair Pipeline Demo
 *
 * Shows the repair pipeline fixing common LLM mistakes without
 * any model round-trip. Each repair layer is deterministic and fast.
 */
import { z } from "zod";
import { createHarness, defineTools } from "tool-harness";

const tools = defineTools({
	send_email: {
		description: "Send an email to one or more recipients.",
		category: "task",
		visibility: "always",
		schema: z.object({
			to: z.array(z.string()).describe("Recipient email addresses"),
			subject: z.string().describe("Email subject"),
			body: z.string().describe("Email body"),
			priority: z.enum(["low", "normal", "high"]).default("normal"),
		}),
		execute: async (input) => ({ sent: true, to: input.to }),
	},

	get_weather: {
		description: "Get weather for a location.",
		category: "read",
		visibility: "always",
		schema: z.object({
			city: z.string(),
			units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
		}),
		execute: async ({ city }) => ({ city, temp: 22 }),
	},

	delete_account: {
		description: "Permanently delete a user account.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			userId: z.string(),
			confirm: z.boolean(),
		}),
		execute: async ({ userId }) => ({ deleted: true, userId }),
	},
});

const harness = createHarness(tools);

console.log("=== Repair Pipeline Demos ===\n");

// 1. Fuzzy tool name matching
console.log("1. Fuzzy tool name:");
const r1 = await harness.dispatch("task", { name: "send_emal", args: { to: ["a@b.com"], subject: "Hi", body: "Hello" } });
console.log("   'send_emal' →", r1);

// 2. Case normalization on keys
console.log("\n2. Key normalization:");
const r2 = await harness.dispatch("task", { name: "send_email", args: { To: ["a@b.com"], Subject: "Hi", Body: "Hello" } });
console.log("   'To/Subject/Body' →", r2);

// 3. Type coercion
console.log("\n3. Type coercion:");
const r3 = await harness.dispatch("task", { name: "delete_account", args: { userId: "u123", confirm: "true" } });
console.log("   confirm: 'true' (string) →", r3);

// 4. Enum fuzzy matching
console.log("\n4. Enum fuzzy match:");
const r4 = await harness.dispatch("task", { name: "send_email", args: {
	to: ["a@b.com"], subject: "Hi", body: "Hello", priority: "hgih"
}});
console.log("   priority: 'hgih' →", r4);

// 5. Single value → array coercion
console.log("\n5. Single → array:");
const r5 = await harness.dispatch("task", { name: "send_email", args: {
	to: "single@email.com", subject: "Hi", body: "Hello"
}});
console.log("   to: 'single@email.com' (not array) →", r5);

// 6. JSON repair (malformed input)
console.log("\n6. JSON repair:");
const r6 = harness.repairJSON(`{'to': ['a@b.com',], subject: "Hi", 'body': "Hello",}`);
console.log("   single quotes + trailing commas →", r6);

// 7. Unknown tool name → structured error
console.log("\n7. Unknown tool:");
const r7 = await harness.dispatch("task", { name: "totally_unknown_tool", args: {} });
console.log("   'totally_unknown_tool' →", r7);
