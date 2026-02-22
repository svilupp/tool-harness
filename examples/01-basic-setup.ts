/**
 * Example 1: Basic Setup
 *
 * Minimal harness setup with 3 tools. Shows:
 * - Defining tools with defineTools()
 * - Creating the harness
 * - Exporting as AI SDK meta-tools
 * - Running with generateText
 */
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { createHarness, defineTools } from "tool-harness";

const tools = defineTools({
	get_weather: {
		description: "Get current weather for a city.",
		category: "read",
		visibility: "always",
		schema: z.object({
			city: z.string().describe("City name"),
			units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
		}),
		execute: async ({ city, units }) => ({
			city,
			temperature: units === "celsius" ? 22 : 72,
			condition: "sunny",
			units,
		}),
	},

	search_docs: {
		description: "Search documentation by keyword.",
		category: "search",
		visibility: "always",
		schema: z.object({
			query: z.string().describe("Search query"),
			limit: z.number().default(5),
		}),
		execute: async ({ query, limit }) => ({
			results: [
				{ title: `Doc about ${query}`, path: `/docs/${query}.md`, score: 0.95 },
			],
			total: 1,
		}),
	},

	send_notification: {
		description: "Send a push notification to a user.",
		category: "task",
		visibility: "listed", // name + one-liner in prompt; details on demand
		schema: z.object({
			userId: z.string().describe("Target user ID"),
			message: z.string().describe("Notification message"),
			priority: z.enum(["low", "normal", "urgent"]).default("normal"),
		}),
		execute: async ({ userId, message, priority }) => ({
			sent: true,
			notificationId: `notif_${Date.now()}`,
		}),
	},
});

const harness = createHarness(tools);

// Generate the prompt block for system prompt injection (via textprompts or directly)
console.log("=== System Prompt Block ===");
console.log(harness.generatePromptBlock());
console.log();

// Export as 3 meta-tools for AI SDK
const metaTools = harness.toMetaTools();
console.log("=== Meta-tool names ===");
console.log(Object.keys(metaTools));
console.log();

// Run with generateText
const result = await generateText({
	model: google("gemini-2.0-flash"),
	tools: metaTools,
	experimental_repairToolCall: harness.repairHook(),
	stopWhen: stepCountIs(5),
	prompt: "What's the weather in Tokyo?",
});

console.log("=== Result ===");
console.log("Text:", result.text);
console.log("Steps:", result.steps.length);
for (const step of result.steps) {
	for (const tc of step.toolCalls) {
		console.log(`  Tool: ${tc.toolName}`, (tc as any).args);
	}
	for (const tr of step.toolResults) {
		console.log(`  Result:`, (tr as any).result);
	}
}
