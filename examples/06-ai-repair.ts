/**
 * Example 6: AI Repair (Layer 6)
 *
 * Shows the optional AI repair layer using gemini-2.5-flash-lite.
 * Only fires when deterministic layers 1-5 all fail.
 * Fast enough to not add meaningful latency.
 */
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { createHarness, defineTools } from "tool-harness";

const tools = defineTools({
	create_meeting: {
		description: "Schedule a meeting with participants.",
		category: "task",
		visibility: "always",
		schema: z.object({
			title: z.string(),
			participants: z.array(z.string().email()),
			date: z.string().describe("ISO 8601 date string"),
			duration: z.number().describe("Duration in minutes"),
			recurring: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
		}),
		examples: [
			{
				title: "Standup",
				participants: ["alice@co.com"],
				date: "2026-02-23T10:00:00Z",
				duration: 30,
			},
		],
		execute: async (input) => ({
			meetingId: `mtg_${Date.now()}`,
			title: input.title,
			scheduled: true,
		}),
	},
});

const harness = createHarness(tools, {
	// Layer 6: AI repair with gemini-2.5-flash-lite
	// Only fires when layers 1-5 can't fix the input
	repairModel: google("gemini-2.5-flash-lite-preview-06-17"),
});

// Simulate a badly mangled tool call that deterministic repair can't fully fix
const badArgs = {
	titel: "Team Standup",           // misspelled key
	ppl: ["alice@co.com"],           // wrong key entirely
	when: "tomorrow at 10am",        // not ISO 8601
	how_long: "thirty minutes",      // string instead of number
	repeat: "every week",            // not a valid enum value
};

console.log("=== Bad Args ===");
console.log(JSON.stringify(badArgs, null, 2));
console.log();

// Deterministic layers will fix some:
// - "titel" → "title" (fuzzy key match)
// - "repeat" → "recurring" (fuzzy key match) + "every week" → "weekly" (fuzzy enum)
// But "ppl" → "participants" is too far, "when" → "date" needs AI, "how_long" is semantic
//
// Layer 6 AI repair takes the remaining failures and the schema,
// asks gemini-2.5-flash-lite to fix them.

console.log("=== Repair Result ===");
const result = await harness.repair("create_meeting", badArgs);
console.log(JSON.stringify(result, null, 2));
