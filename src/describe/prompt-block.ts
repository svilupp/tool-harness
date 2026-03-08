import type { ToolDef } from "../types.ts";
import { toolSignature } from "./signature.ts";

export interface PromptBlockOptions {
	style?:
		| "minimal"
		| "grouped"
		| "grouped_with_breadth"
		| "grouped_with_examples"
		| "full";
	maxEnumValues?: number;
	domainGroups?: Record<string, string[]>;
	breadthExamples?: Record<
		string,
		{ description: string; input: Record<string, unknown> }[]
	>;
}

export function generatePromptBlock(
	tools: Array<{ name: string; tool: ToolDef }>,
	options?: PromptBlockOptions,
): string {
	const style = options?.style ?? "grouped_with_breadth";

	if (style === "minimal") {
		return generateMinimalBlock(tools);
	}

	return generateGroupedBlock(tools, options ?? {});
}

function generateMinimalBlock(
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

	// Action guidance section
	lines.push("");
	lines.push(...buildActionGuidance());

	return lines.join("\n");
}

function generateGroupedBlock(
	tools: Array<{ name: string; tool: ToolDef }>,
	options: PromptBlockOptions,
): string {
	const style = options.style ?? "grouped_with_breadth";
	const lines: string[] = [];
	lines.push("## Available Actions");

	// Build groups: domainGroups if provided, otherwise by category
	const groups = buildGroups(tools, options.domainGroups);

	for (const [groupLabel, groupTools] of groups) {
		if (groupTools.length === 0) continue;

		lines.push("");
		lines.push(`### ${groupLabel}`);
		lines.push(
			`When the user wants to ${groupLabel.toLowerCase().replace(/&/g, "or")}:`,
		);
		for (const { name, tool } of groupTools) {
			lines.push(`- ${toolSignature(name, tool)}`);
		}

		// Add breadth examples for grouped_with_examples and full styles
		if (
			(style === "grouped_with_examples" || style === "full") &&
			options.breadthExamples
		) {
			const groupToolNames = new Set(groupTools.map((t) => t.name));
			const matchingExamples: {
				description: string;
				input: Record<string, unknown>;
			}[] = [];

			for (const [family, examples] of Object.entries(
				options.breadthExamples,
			)) {
				if (groupToolNames.has(family)) {
					matchingExamples.push(...examples);
				}
			}

			if (matchingExamples.length > 0) {
				lines.push("");
				lines.push("Usage patterns:");
				for (const ex of matchingExamples) {
					const argsStr = Object.entries(ex.input)
						.map(([k, v]) =>
							typeof v === "string" ? `${k}="${v}"` : `${k}=${v}`,
						)
						.join(", ");
					// Find the tool name that matches this example
					const toolName =
						[...groupToolNames].find((n) =>
							Object.keys(ex.input).some((k) => {
								const t = groupTools.find((gt) => gt.name === n);
								return t && Object.keys(t.tool.schema.shape).includes(k);
							}),
						) ??
						groupTools[0]?.name ??
						"tool";
					lines.push(`- ${ex.description}: ${toolName}(${argsStr})`);
				}
			}
		}
	}

	// Action guidance section
	lines.push("");
	lines.push(...buildActionGuidance());

	return lines.join("\n");
}

function buildGroups(
	tools: Array<{ name: string; tool: ToolDef }>,
	domainGroups?: Record<string, string[]>,
): Array<[string, Array<{ name: string; tool: ToolDef }>]> {
	if (domainGroups) {
		const result: Array<[string, Array<{ name: string; tool: ToolDef }>]> = [];
		const toolMap = new Map(tools.map((t) => [t.name, t]));
		const assigned = new Set<string>();

		for (const [label, names] of Object.entries(domainGroups)) {
			const groupTools: Array<{ name: string; tool: ToolDef }> = [];
			for (const name of names) {
				const t = toolMap.get(name);
				if (t) {
					groupTools.push(t);
					assigned.add(name);
				}
			}
			result.push([label, groupTools]);
		}

		// Any unassigned tools go into "Other"
		const unassigned = tools.filter((t) => !assigned.has(t.name));
		if (unassigned.length > 0) {
			result.push(["Other", unassigned]);
		}

		return result;
	}

	// Group by category
	const categoryMap = new Map<string, Array<{ name: string; tool: ToolDef }>>();
	for (const t of tools) {
		const cat = t.tool.category;
		const label = cat.charAt(0).toUpperCase() + cat.slice(1);
		if (!categoryMap.has(label)) categoryMap.set(label, []);
		categoryMap.get(label)?.push(t);
	}
	return [...categoryMap.entries()];
}

function buildActionGuidance(): string[] {
	return [
		"## Action Guidance",
		"- When the user requests an action, execute it immediately \u2014 do not ask for confirmation unless the action is irreversible.",
		"- When the user confirms a previous suggestion, execute the corresponding tool call.",
		"- Prefer calling a tool over asking clarifying questions when the intent is clear.",
	];
}
