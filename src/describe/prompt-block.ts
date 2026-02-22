import { generateObjectExample } from "../introspect.ts";
import type { ToolDef } from "../types.ts";
import { toolSignature } from "./signature.ts";

const MAX_EXAMPLES = 3;

export function generatePromptBlock(
	tools: Array<{ name: string; tool: ToolDef }>,
): string {
	const always = tools.filter((t) => t.tool.visibility === "always");
	const listed = tools.filter((t) => t.tool.visibility === "listed");
	const hidden = tools.filter((t) => t.tool.visibility === "hidden");

	const lines: string[] = [];
	lines.push("## Available Tools");

	if (always.length > 0) {
		lines.push("");
		lines.push("### Core Tools");
		for (const { name, tool } of always) {
			lines.push(toolSignature(name, tool));
		}
	}

	if (listed.length > 0) {
		lines.push("");
		lines.push("### Additional Tools");
		for (const { name, tool } of listed) {
			lines.push(toolSignature(name, tool));
		}
	}

	if (hidden.length > 0) {
		lines.push("");
		lines.push(
			`${hidden.length} additional tool(s) available. Use read("tools") to discover.`,
		);
	}

	// Few-shot examples section
	const exampleLines = buildFewShotExamples([...always, ...listed]);
	if (exampleLines.length > 0) {
		lines.push("");
		lines.push("## Example Tool Calls");
		lines.push("");
		lines.push(...exampleLines);
	}

	// Negative examples section (always shown)
	lines.push("");
	lines.push(...buildNegativeExamples());

	return lines.join("\n");
}

interface FormattedExample {
	user: string;
	call: string;
}

function buildFewShotExamples(
	tools: Array<{ name: string; tool: ToolDef }>,
): string[] {
	const examples: FormattedExample[] = [];

	// Prioritize: tools with explicit examples first, then "always" visibility, then listed
	const withExamples = tools.filter(
		(t) => t.tool.examples && t.tool.examples.length > 0,
	);
	const withoutExamples = tools.filter(
		(t) => !t.tool.examples || t.tool.examples.length === 0,
	);

	// Collect from explicit examples
	for (const { name, tool } of withExamples) {
		if (examples.length >= MAX_EXAMPLES) break;
		for (const ex of tool.examples ?? []) {
			if (examples.length >= MAX_EXAMPLES) break;
			examples.push(formatToolExample(name, tool, ex));
		}
	}

	// Fill remaining slots with synthetic examples
	for (const { name, tool } of withoutExamples) {
		if (examples.length >= MAX_EXAMPLES) break;
		const syntheticArgs = generateObjectExample(tool.schema);
		examples.push(formatToolExample(name, tool, syntheticArgs));
	}

	if (examples.length === 0) return [];

	const lines: string[] = [];
	let first = true;
	for (const ex of examples) {
		if (!first) lines.push("");
		first = false;
		lines.push(`User: "${ex.user}"`);
		lines.push(ex.call);
	}
	return lines;
}

function formatToolExample(
	name: string,
	tool: ToolDef,
	args: Record<string, unknown>,
): FormattedExample {
	const wrapper = tool.category;
	const argsJson = JSON.stringify(args);

	// Build a natural user prompt from the args
	// Find the primary string arg (usually 'query', 'product_id', etc.)
	const primaryArg = Object.entries(args).find(
		([_, v]) => typeof v === "string",
	);
	const descFirstSentence = tool.description.split(".")[0] ?? tool.description;
	const userPrompt = primaryArg
		? `${descFirstSentence} — e.g. "${primaryArg[1]}"`
		: descFirstSentence;

	let call: string;
	if (wrapper === "task") {
		call = `\u2192 task(name="${name}", args=${argsJson})`;
	} else if (wrapper === "read") {
		const { [Object.keys(args)[0] as string]: _firstVal, ...rest } = args;
		const restJson = JSON.stringify(rest);
		call = `\u2192 read(target="${name}"${restJson !== "{}" ? `, ${restJson.slice(1, -1)}` : ""})`;
	} else {
		// search
		call = `\u2192 search(${argsJson.slice(1, -1)})`;
	}

	return { user: userPrompt, call };
}

function buildNegativeExamples(): string[] {
	return [
		"## When NOT to Call Tools",
		"- User is making conversation or thinking out loud \u2192 respond naturally",
		"- User hasn't given enough specifics \u2192 ask clarifying questions first",
		"- User is responding to your question \u2192 continue the conversation",
		"",
		'User: "That sounds interesting, tell me more"',
		"\u2192 [no tool call \u2014 respond conversationally]",
		"",
		'User: "Hmm, I\'m not sure yet"',
		"\u2192 [no tool call \u2014 ask what they need]",
		"",
		'User: "Add that to my cart" (after seeing search results)',
		"\u2192 [call cart_add with the product ID from results \u2014 don't re-search]",
	];
}
