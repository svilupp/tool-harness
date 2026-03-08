import type { ToolDef, ToolDefs } from "./types.ts";

export interface TurnContext {
	state: string;
	activeHandles: string[];
	turnNumber: number;
	lastToolCalled: string | null;
	provider?: string | undefined;
}

export interface ActivationRule {
	type: "state_match" | "handle_present" | "always" | "never";
	condition: (ctx: TurnContext) => boolean;
}

export interface Capability {
	name: string;
	domain: string;
	group: string;
	tool: ToolDef;
	activationRules: ActivationRule[];
}

export class CapabilityRegistry {
	private capabilities: Capability[] = [];

	register(cap: Capability): void {
		const idx = this.capabilities.findIndex((c) => c.name === cap.name);
		if (idx !== -1) {
			this.capabilities[idx] = cap;
		} else {
			this.capabilities.push(cap);
		}
	}

	registerFromToolDef(
		name: string,
		tool: ToolDef,
		opts: {
			domain: string;
			group: string;
			activationRules?: ActivationRule[];
		},
	): void {
		this.register({
			name,
			domain: opts.domain,
			group: opts.group,
			tool,
			activationRules: opts.activationRules ?? [
				{ type: "always", condition: () => true },
			],
		});
	}

	static fromToolDefs(
		tools: ToolDefs,
		domainMap: Record<
			string,
			{ domain: string; group: string; activationRules?: ActivationRule[] }
		>,
	): CapabilityRegistry {
		const registry = new CapabilityRegistry();
		for (const [name, tool] of Object.entries(tools)) {
			const mapping = domainMap[name];
			const opts: {
				domain: string;
				group: string;
				activationRules?: ActivationRule[];
			} = {
				domain: mapping?.domain ?? "default",
				group: mapping?.group ?? "default",
			};
			if (mapping?.activationRules)
				opts.activationRules = mapping.activationRules;
			registry.registerFromToolDef(name, tool, opts);
		}
		return registry;
	}

	getActive(ctx: TurnContext): Capability[] {
		return this.capabilities
			.filter(
				(cap) =>
					cap.activationRules.length > 0 &&
					cap.activationRules.some((rule) => rule.condition(ctx)),
			)
			.sort((a, b) => (b.tool.priority ?? 0) - (a.tool.priority ?? 0));
	}

	getAll(): Capability[] {
		return [...this.capabilities];
	}

	getByDomain(domain: string): Capability[] {
		return this.capabilities.filter((c) => c.domain === domain);
	}

	getByGroup(group: string): Capability[] {
		return this.capabilities.filter((c) => c.group === group);
	}

	size(): number {
		return this.capabilities.length;
	}
}
