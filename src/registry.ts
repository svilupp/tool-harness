import { closest, distance } from "fastest-levenshtein";
import type { Category, ToolDef } from "./types.ts";

function normalize(name: string): string {
	return name
		.replace(/[.-]/g, "_")
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.toLowerCase();
}

export class ToolRegistry {
	private tools = new Map<string, ToolDef>();
	private insertionOrder: string[] = [];
	private nameIndex = new Map<string, string>(); // normalized → canonical

	register(name: string, def: ToolDef): void {
		const existed = this.tools.has(name);
		this.tools.set(name, def);
		if (!existed) {
			this.insertionOrder.push(name);
		}
		// Index all normalized variants
		this.nameIndex.set(name.toLowerCase(), name);
		this.nameIndex.set(normalize(name), name);
	}

	unregister(name: string): void {
		this.tools.delete(name);
		this.insertionOrder = this.insertionOrder.filter((n) => n !== name);
		// Remove index entries pointing to this name
		for (const [key, val] of this.nameIndex) {
			if (val === name) this.nameIndex.delete(key);
		}
	}

	get(name: string): ToolDef | undefined {
		return this.tools.get(name);
	}

	resolve(name: string): { name: string; tool: ToolDef } | null {
		// 1. Exact match
		const exact = this.tools.get(name);
		if (exact) return { name, tool: exact };

		// 2. Case-insensitive / normalized
		const normalizedInput = normalize(name);
		const indexed =
			this.nameIndex.get(name.toLowerCase()) ??
			this.nameIndex.get(normalizedInput);
		if (indexed) {
			const tool = this.tools.get(indexed);
			if (tool) return { name: indexed, tool };
		}

		// 3. startsWith prefix (if exactly one match)
		const lowerInput = name.toLowerCase();
		const allNames = Array.from(this.tools.keys());
		const prefixMatches = allNames.filter((n) =>
			n.toLowerCase().startsWith(lowerInput),
		);
		if (prefixMatches.length === 1) {
			const match = prefixMatches[0] as string;
			const matchTool = this.tools.get(match);
			if (matchTool) return { name: match, tool: matchTool };
		}

		// 4. Levenshtein fuzzy match (≥ 0.7 similarity)
		if (allNames.length === 0) return null;
		const best = closest(name, allNames);
		const d = distance(name, best);
		const maxLen = Math.max(name.length, best.length);
		const similarity = 1 - d / maxLen;
		if (similarity >= 0.7) {
			const bestTool = this.tools.get(best);
			if (bestTool) return { name: best, tool: bestTool };
		}

		return null;
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	list(category?: Category): Array<{ name: string; tool: ToolDef }> {
		const entries = this.insertionOrder
			.flatMap((name) => {
				const t = this.tools.get(name);
				return t ? [{ name, tool: t }] : [];
			})
			.filter((e) => !category || e.tool.category === category);

		// Sort by priority desc (higher first), then insertion order
		return entries.sort(
			(a, b) => (b.tool.priority ?? 0) - (a.tool.priority ?? 0),
		);
	}

	listNames(category?: Category): string[] {
		return this.list(category).map((e) => e.name);
	}

	size(): number {
		return this.tools.size;
	}
}
