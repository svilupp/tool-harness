import { jsonrepair } from "jsonrepair";
import type { RepairAction } from "../types.ts";

export function repairJSON(
	raw: string,
): { data: Record<string, unknown>; repairs: RepairAction[] } | null {
	try {
		// Strip markdown fences
		let cleaned = raw;
		const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
		if (fenceMatch?.[1]) cleaned = fenceMatch[1];

		const repaired = jsonrepair(cleaned);
		let parsed = JSON.parse(repaired);

		// If array result, extract first object
		if (Array.isArray(parsed)) {
			const obj = parsed.find(
				(item) =>
					typeof item === "object" && item !== null && !Array.isArray(item),
			);
			if (obj) parsed = obj;
			else return null;
		}

		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return null;

		const repairs: RepairAction[] = [];
		if (cleaned !== raw || repaired !== cleaned) {
			repairs.push({
				field: "_json",
				original: raw,
				repaired: parsed,
				strategy: "json_fix",
			});
		}

		return { data: parsed as Record<string, unknown>, repairs };
	} catch {
		return null;
	}
}
