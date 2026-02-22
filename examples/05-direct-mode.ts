/**
 * Example 5: Direct Mode (All Tools Exposed)
 *
 * Shows that the harness supports both meta-tool mode (3 tools)
 * and direct mode (all tools exposed individually). Direct mode
 * is zero extra work — same defineTools, same repair pipeline.
 * The repair hook works on every tool's args regardless of mode.
 */
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { createHarness, defineTools } from "tool-harness";

const tools = defineTools({
	get_weather: {
		description: "Get weather for a city.",
		category: "read",
		visibility: "always",
		schema: z.object({
			city: z.string(),
			units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
		}),
		execute: async ({ city, units }) => ({ city, temp: 22, units }),
	},

	calculate: {
		description: "Evaluate a math expression.",
		category: "task",
		visibility: "always",
		schema: z.object({
			expression: z.string().describe("Math expression to evaluate"),
		}),
		execute: async ({ expression }) => {
			// Simple eval for demo (use a proper math parser in production)
			const result = Function(`"use strict"; return (${expression})`)();
			return { expression, result };
		},
	},

	send_email: {
		description: "Send an email.",
		category: "task",
		visibility: "always",
		schema: z.object({
			to: z.array(z.string()),
			subject: z.string(),
			body: z.string(),
		}),
		execute: async (input) => ({ sent: true }),
	},
});

const harness = createHarness(tools);

// Direct mode: each tool is an individual AI SDK tool
// Repair hook still works — catches type coercion, enum fixes, etc.
const directTools = harness.toDirectTools();
console.log("=== Direct Mode Tools ===");
console.log("Tools exposed:", Object.keys(directTools));
console.log();

// Meta mode for comparison
const metaTools = harness.toMetaTools();
console.log("=== Meta Mode Tools ===");
console.log("Tools exposed:", Object.keys(metaTools));
console.log();

// Direct mode usage with AI SDK
const result = await generateText({
	model: google("gemini-2.0-flash"),
	tools: directTools,
	experimental_repairToolCall: harness.repairHook(), // same repair hook works in both modes
	stopWhen: stepCountIs(5),
	prompt: "What's the weather in Paris and also calculate 15 * 23 + 7?",
});

console.log("=== Direct Mode Result ===");
console.log("Text:", result.text);
for (const step of result.steps) {
	for (const tc of step.toolCalls) {
		console.log(`  Called: ${tc.toolName}(${JSON.stringify((tc as any).args)})`);
	}
}
