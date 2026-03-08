export class HandleStore {
	private counter = 0;
	private handles = new Map<
		string,
		{
			type: string;
			data: unknown[];
			meta?: Record<string, unknown>;
			createdAt: number;
		}
	>();

	/**
	 * Create a new handle for a result set, resource, or state snapshot.
	 * Returns the handle ID (e.g., "result_set_1").
	 */
	create(
		type: "result_set" | "resource" | "state",
		data: unknown[],
		meta?: Record<string, unknown>,
	): string {
		this.counter++;
		const id = `${type}_${this.counter}`;
		const entry: {
			type: string;
			data: unknown[];
			meta?: Record<string, unknown>;
			createdAt: number;
		} = { type, data, createdAt: Date.now() };
		if (meta !== undefined) entry.meta = meta;
		this.handles.set(id, entry);
		return id;
	}

	/**
	 * Resolve a handle reference, optionally with a position (1-indexed).
	 * Returns the item at that position, or null if not found.
	 */
	resolve(handleId: string, position?: number): unknown | null {
		const handle = this.handles.get(handleId);
		if (!handle) return null;
		if (position === undefined) return handle.data;
		// 1-indexed
		const idx = position - 1;
		if (idx < 0 || idx >= handle.data.length) return null;
		return handle.data[idx];
	}

	/**
	 * Get the full handle entry, or null if not found.
	 */
	get(handleId: string): {
		type: string;
		data: unknown[];
		meta?: Record<string, unknown>;
	} | null {
		const entry = this.handles.get(handleId);
		if (!entry) return null;
		const result: {
			type: string;
			data: unknown[];
			meta?: Record<string, unknown>;
		} = { type: entry.type, data: entry.data };
		if (entry.meta !== undefined) result.meta = entry.meta;
		return result;
	}

	/**
	 * List all active handle IDs.
	 */
	list(): string[] {
		return Array.from(this.handles.keys());
	}

	/**
	 * Get only handle IDs of a specific type.
	 */
	listByType(type: string): string[] {
		return Array.from(this.handles.entries())
			.filter(([_, v]) => v.type === type)
			.map(([k]) => k);
	}

	/**
	 * Format a handle's data for model consumption.
	 * - 'full': numbered list with all fields
	 * - 'compact': numbered list with key fields only
	 * - 'ids_only': just the IDs/names
	 */
	format(
		handleId: string,
		style: "full" | "compact" | "ids_only",
		options?: { keyField?: string; labelField?: string },
	): string {
		const handle = this.handles.get(handleId);
		if (!handle) return `[Handle ${handleId} not found]`;

		const keyField = options?.keyField ?? "id";
		const labelField = options?.labelField ?? "name";

		const lines: string[] = [`${handleId} (${handle.data.length} items):`];

		for (let i = 0; i < handle.data.length; i++) {
			const item = handle.data[i];
			const pos = i + 1;

			if (style === "ids_only") {
				const id =
					typeof item === "object" && item !== null
						? ((item as Record<string, unknown>)[keyField] ?? `pos_${pos}`)
						: String(item);
				lines.push(`  ${pos}. ${id}`);
			} else if (style === "compact") {
				const id =
					typeof item === "object" && item !== null
						? ((item as Record<string, unknown>)[keyField] ?? "")
						: "";
				const label =
					typeof item === "object" && item !== null
						? ((item as Record<string, unknown>)[labelField] ?? "")
						: String(item);
				lines.push(`  ${pos}. ${label} (${id})`);
			} else {
				// full
				lines.push(`  ${pos}. ${JSON.stringify(item)}`);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Generate a state reminder string showing all active handles.
	 */
	stateReminder(): string {
		if (this.handles.size === 0) return "";
		const parts: string[] = ["Active result sets:"];
		for (const [id, entry] of this.handles) {
			const desc = entry.meta?.["description"] ?? `${entry.data.length} items`;
			parts.push(`- ${id}: ${desc}`);
		}
		return parts.join("\n");
	}

	/**
	 * Return all active handle IDs (for TurnContext.activeHandles).
	 */
	activeHandleIds(): string[] {
		return Array.from(this.handles.keys());
	}

	/**
	 * Remove a specific handle.
	 */
	remove(handleId: string): boolean {
		return this.handles.delete(handleId);
	}

	/**
	 * Clear all handles.
	 */
	clear(): void {
		this.handles.clear();
		this.counter = 0;
	}
}
