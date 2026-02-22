/**
 * Example 3: PopTime (bob-time) Tool Migration
 *
 * Shows how 8 current PopTime tools compress to 3 meta-tools
 * while preserving all capabilities. Each current tool becomes
 * either a route in read/search or a named task.
 */
import { z } from "zod";
import { createHarness, defineTools } from "tool-harness";

// Simulated external services
const sift = async (query: string, scope: string) => [{ path: "/docs/result.md", score: 0.9 }];
const mem = async (fact: string) => "Remembered.";
const cloop = {
	run: async (prompt: string) => ({ id: "sess_abc", status: "running" }),
	status: async (id: string) => ({ id, status: "completed", outcome: "DONE" }),
};

const tools = defineTools({
	// ── read: file reading + virtual paths ──
	// Absorbs: read, status, skills (via virtual paths)
	"file.read": {
		description: "Read file contents with paging.",
		category: "read",
		visibility: "always",
		schema: z.object({
			path: z.string().describe("File path or virtual path (status, skills/query, tools/name)"),
			head: z.number().optional().describe("Read first N lines"),
			tail: z.number().optional().describe("Read last N lines"),
		}),
		execute: async ({ path, head, tail }) => {
			if (path === "status") {
				return "## Status\n- Workers: 1 running\n- Messages: 24 (20 visible)\n- No unread notifications";
			}
			if (path.startsWith("skills/")) {
				const query = path.slice(7);
				return `Found skills matching "${query}": dev:pr-description, dev:step-research`;
			}
			return `Contents of ${path} (first ${head ?? 50} lines)...`;
		},
	},

	// ── search: hybrid search ──
	// Absorbs: search + skills_search (via scope)
	"hybrid.search": {
		description: "Search memory, conversations, docs, skills via hybrid BM25 + vector.",
		category: "search",
		visibility: "always",
		schema: z.object({
			query: z.string().describe("Search query"),
			scope: z.enum(["all", "conversations", "memory", "docs", "skills", "vault", "logs", "artifacts"]).default("all"),
			limit: z.number().default(5),
			since: z.string().optional().describe('Time filter: "2d", "1w"'),
		}),
		execute: async ({ query, scope, limit }) => {
			if (scope === "skills") {
				return { results: [{ name: "dev:step-research", description: "Research Phase" }] };
			}
			return { results: await sift(query, scope), total: 1 };
		},
	},

	// ── task: worker.new ──
	"worker.new": {
		description: "Launch a Claude Code worker for coding tasks.",
		category: "task",
		visibility: "always",
		schema: z.object({
			prompt: z.string().describe("Task description for the worker"),
			workDir: z.string().optional().describe('"project", "vault", or relative path'),
			label: z.string().optional().describe("Human-readable label"),
			skillPath: z.string().optional().describe("Path to SKILL.md for worker instructions"),
		}),
		execute: async ({ prompt, workDir, label }) => {
			const session = await cloop.run(prompt);
			return { success: true, workerId: "w-abc123", sessionId: session.id, status: "started" };
		},
	},

	"worker.status": {
		description: "Check a worker's progress.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			sessionId: z.string().describe("Worker session ID"),
		}),
		execute: async ({ sessionId }) => cloop.status(sessionId),
	},

	"worker.continue": {
		description: "Resume a worker with a new prompt.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			sessionId: z.string().describe("Worker session ID"),
			prompt: z.string().describe("Follow-up instructions"),
		}),
		execute: async ({ sessionId, prompt }) => ({ success: true, status: "resumed" }),
	},

	"worker.list": {
		description: "List all workers and their statuses.",
		category: "task",
		visibility: "listed",
		schema: z.object({}),
		execute: async () => "No workers registered.",
	},

	"worker.cancel": {
		description: "Cancel a running worker.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			sessionId: z.string().describe("Worker session ID"),
		}),
		execute: async ({ sessionId }) => ({ success: true, message: "Cancelled." }),
	},

	// ── task: remember ──
	remember: {
		description: "Save a fact to long-term memory.",
		category: "task",
		visibility: "always",
		schema: z.object({
			fact: z.string().describe("The fact to remember"),
			ref: z.string().optional().describe("Reference (file path, URL, context)"),
		}),
		execute: async ({ fact, ref }) => mem(fact),
	},

	// ── task: think ──
	think: {
		description: "Private reasoning scratchpad. Not shown to user.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			thought: z.string().describe("Internal reasoning"),
		}),
		execute: async ({ thought }) => thought,
	},

	// ── task: asset management ──
	"asset.add": {
		description: "Publish a file to the Assets tab.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			path: z.string().describe("File path to publish"),
			description: z.string().describe("Asset description"),
			type: z.enum(["report", "audio", "document", "other"]).default("other"),
		}),
		execute: async ({ path, description, type }) => ({
			assetId: `asset_${Date.now()}`,
			name: path.split("/").pop(),
		}),
	},

	"asset.list": {
		description: "List current assets.",
		category: "task",
		visibility: "listed",
		schema: z.object({}),
		execute: async () => "No assets.",
	},

	"asset.remove": {
		description: "Remove an asset by ID.",
		category: "task",
		visibility: "listed",
		schema: z.object({
			assetId: z.string().describe("Asset ID to remove"),
		}),
		execute: async ({ assetId }) => ({ removed: true }),
	},
});

const harness = createHarness(tools);

// What the model sees in the system prompt
console.log("=== PopTime System Prompt Block ===");
console.log(harness.generatePromptBlock());
console.log();

// Compare: before vs after
console.log("=== Before: 8 separate AI SDK tools ===");
console.log("read, search, workers, status, remember, internal_thinking, visual_actions, skills_search");
console.log();
console.log("=== After: 3 meta-tools ===");
console.log(Object.keys(harness.toMetaTools()).join(", "));
console.log();

// Verify dispatch works
console.log("=== Dispatch Tests ===");
const r1 = await harness.dispatch("task", { name: "worker.new", args: { prompt: "Fix the login bug" } });
console.log("worker.new:", r1);

const r2 = await harness.dispatch("read", { target: "status" });
console.log("read(status):", r2);

const r3 = await harness.dispatch("search", { query: "yesterday's decision", scope: "conversations" });
console.log("search(conversations):", r3);

const r4 = await harness.dispatch("task", { name: "remember", args: { fact: "User prefers dark mode" } });
console.log("remember:", r4);
