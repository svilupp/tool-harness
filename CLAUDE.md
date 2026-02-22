Default to Bun over Node.js (`bun test`, `bun run`, `bun install`). Bun auto-loads `.env`.

## Stack

- TypeScript, Zod v4, AI SDK v6
- `Bun.serve()` for servers (no Express/Vite)
- `bun:sqlite`, `Bun.file`, `Bun.$` over third-party equivalents
- `bun test` (built-in, jest-compatible API)

## Key Files

- `src/index.ts` — public API surface (`defineTools`, `createHarness`)
- `src/harness.ts` — core harness logic, meta-tool generation
- `src/registry.ts` — tool registry and category management
- `src/types.ts` — shared types (`ToolDef`, `HarnessConfig`, etc.)
- `src/introspect.ts` — runtime tool introspection
- `src/direct-tools.ts` — direct (non-meta) tool mode
- `src/meta-tools.ts` — meta-tool consolidation logic
- `src/describe/` — tool description & prompt block generation
- `src/repair/` — 7-layer auto-repair pipeline (JSON repair, type coercion, fuzzy enum, AI repair)
- `tests/` — mirrors `src/` structure (`harness.test.ts`, `repair.test.ts`, etc.)
- `examples/` — numbered usage examples (`01-basic-setup.ts` through `06-ai-repair.ts`)

## Commands

- `bun test` — run all tests
- `bun run typecheck` — strict type-check (`exactOptionalPropertyTypes`, `noUnusedLocals`, etc.)
- `bun run lint` — biome check (formatting + lint)
- `bun run lint:fix` — biome auto-fix
- `bun run oxlint` — oxlint check
- `bun run check` — typecheck + lint + oxlint + test (same as CI)
