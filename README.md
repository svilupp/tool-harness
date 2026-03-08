# tool-harness

[![Docs](https://img.shields.io/badge/docs-API%20Reference-blue?style=flat&logo=gitbook&logoColor=white)](https://svilupp.github.io/tool-harness/)
[![npm version](https://img.shields.io/npm/v/tool-harness.svg)](https://www.npmjs.com/package/tool-harness)
[![CI status](https://github.com/svilupp/tool-harness/workflows/CI/badge.svg)](https://github.com/svilupp/tool-harness/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/npm/l/tool-harness.svg)](https://github.com/svilupp/tool-harness/blob/main/LICENSE)

> **Warning**: This library is in **alpha** and highly experimental. APIs may change without notice. Use at your own risk.

A lightweight TypeScript library for reliable AI tool use. Consolidates tools into meta-tools, auto-repairs malformed arguments, and reduces false negatives with structural toolChoice hints. Built for [AI SDK v6](https://ai-sdk.dev).

```typescript
import { defineTools, createHarness } from "tool-harness";
import { z } from "zod";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const tools = defineTools({
  getWeather: {
    description: "Get weather for a city",
    category: "read",
    visibility: "always",
    schema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ temp: 72, city }),
  },
});

const harness = createHarness(tools);

const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toMetaTools(),
  prompt: "What's the weather in Paris?",
});
```

## Why tool-harness?

Large tool sets create problems for language models: bloated system prompts, frequent argument errors, and brittle integrations. `tool-harness` solves all three.

| Problem | Without tool-harness | With tool-harness |
|---|---|---|
| Tool count in context | 20+ tool definitions | 3 meta-tools (`read`, `search`, `task`) |
| Malformed arguments | Hard failure, retry loop | Auto-repaired through 7-layer pipeline |
| Misspelled tool names | `NoSuchToolError` | Fuzzy-matched via Levenshtein distance |
| Wrong enum values | Validation error | Coerced, synonym-matched, or fuzzy-fixed |
| Missing defaults | Schema rejection | Injected automatically |
| Token overhead | Full schema per tool | Compact signatures with visibility control |

## Installation

```bash
npm install tool-harness zod ai
```

`tool-harness` requires `zod` (v4+) and `ai` (v6+) as peer-adjacent dependencies. Install a provider SDK for your model of choice:

```bash
# Pick one (or more)
npm install @ai-sdk/anthropic
npm install @ai-sdk/openai
npm install @ai-sdk/google
```

## Core Concepts

### Meta-tool pattern

Instead of exposing every tool individually, `tool-harness` groups tools into three categories:

- **`read`** -- Retrieve information. The model passes a `target` (a tool name or virtual path like `tools` or `tools/<name>`) and the harness routes to the correct tool.
- **`search`** -- Query for results. The model provides a query and optional filters; the harness dispatches to the appropriate search tool.
- **`task`** -- Execute an action. The model specifies a task `name` and `args`; the harness resolves the tool (with fuzzy matching), repairs the arguments, and executes.

This reduces context window usage while keeping the full tool set accessible.

### Repair pipeline

Invalid tool arguments pass through a 7-layer repair pipeline (valid inputs are passed through unchanged):

1. **JSON repair** -- Fix malformed JSON (unclosed strings, trailing commas, missing brackets)
2. **Key normalization** -- Map `camelCase`, `snake_case`, and prefix variants to canonical schema keys
3. **Type coercion** -- Convert `"true"` to `true`, `"42"` to `42`, and similar
4. **Fuzzy enum matching** -- Levenshtein distance for close misspellings (`"celcius"` to `"celsius"`)
5. **Synonym + semantic enum matching** -- Map paraphrases and natural-language variants to enum values
6. **Default injection** -- Fill missing optional fields with schema defaults
7. **AI repair (opt-in)** -- Use a language model for complex structural fixes; falls back to a structured error with field-level diagnostics

Layers 1-6 are synchronous and deterministic. Layer 7 is async and requires an explicit `repairModel` in the harness config.

### Tool definition

Define tools with `defineTools()`. Each tool declares a Zod schema, an async `execute` function, a `category`, and a `visibility` level:

```typescript
import { defineTools } from "tool-harness";
import { z } from "zod";

const tools = defineTools({
  readFile: {
    description: "Read a file from disk",
    category: "read",
    visibility: "always",
    schema: z.object({
      path: z.string().describe("Absolute file path"),
    }),
    execute: async ({ path }) => {
      return Bun.file(path).text();
    },
  },
  grep: {
    description: "Search file contents with regex",
    category: "search",
    visibility: "listed",
    schema: z.object({
      pattern: z.string(),
      glob: z.string().optional(),
    }),
    execute: async ({ pattern, glob }) => {
      // search implementation
    },
  },
  writeFile: {
    description: "Write content to a file",
    category: "task",
    visibility: "always",
    schema: z.object({
      path: z.string(),
      content: z.string(),
    }),
    execute: async ({ path, content }) => {
      await Bun.write(path, content);
      return { written: path };
    },
  },
});
```

### Visibility levels

Visibility controls how tools appear in meta-tool descriptions:

| Level | In schema | In description | Use case |
|---|---|---|---|
| `always` | Yes | Yes | Primary tools the model should use frequently |
| `listed` | Yes | Yes | Available tools shown in the tool list |
| `hidden` | Yes | No | Dispatchable but not advertised (reduces prompt noise) |

In **hybrid mode** (`toHybridTools()`), `always`-visibility task tools are exposed directly alongside the meta-tools, giving the model a fast path for high-priority actions.

## Examples

### Meta-tool mode (recommended)

Expose 3 tools regardless of how many you define:

```typescript
import { defineTools, createHarness } from "tool-harness";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const tools = defineTools({ /* ... your tools ... */ });
const harness = createHarness(tools);

const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toMetaTools(), // { read, search, task }
  prompt: "Find all TODO comments in the project",
});
```

### Direct mode

Expose every tool individually (standard AI SDK pattern, but with repair):

```typescript
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toDirectTools(),
  prompt: "Read the config file",
});
```

### Hybrid mode

Combine direct access for high-priority tools with meta-tools for everything else:

```typescript
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toHybridTools(),
  prompt: "Write a test file and search for related code",
});
```

### Repair hook

Attach the repair pipeline as an error-recovery hook for any mode:

```typescript
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toDirectTools(),
  repairToolCall: harness.repairHook({ mode: "direct" }),
  prompt: "Check the weather",
});
```

### Reducing false negatives

Models often fail to act after user confirmations ("Yes, go ahead"). Use `suggestToolChoice` to detect these turns and force tool calls:

```typescript
const toolChoice = harness.suggestToolChoice({
  lastAssistantMessage: previousAssistantText,
  lastUserMessage: userMessage,
  turnNumber: turn,
});

const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toDirectTools(),
  toolChoice,
  prompt: userMessage,
});
```

### AI-assisted repair

Enable the optional AI repair layer for complex structural fixes:

```typescript
const harness = createHarness(tools, {
  repairModel: anthropic("claude-haiku-4-20250514"),
});
```

### Programmatic repair

Use the repair pipeline directly without executing the tool:

```typescript
const result = await harness.repair("getWeather", { citty: "Paris" });
// result.ok === true, result.data === { city: "Paris" }
// result.repairs === [{ field: "citty", strategy: "key_normalize", ... }]
```

### Introspection

Generate token-efficient tool descriptions for system prompts:

```typescript
// Compact prompt block for all tools
const block = harness.generatePromptBlock(); // grouped_with_breadth (default)
const minimal = harness.generatePromptBlock({ style: "minimal" });

// Detailed signature for a single tool
const detail = harness.getToolDetail("readFile");

// One-line summaries
const summaries = harness.listToolSummaries();
```

### Dynamic tool loading

Add or remove tools at runtime:

```typescript
harness.loadTools({
  newTool: {
    description: "A newly added tool",
    category: "task",
    visibility: "listed",
    schema: z.object({ input: z.string() }),
    execute: async ({ input }) => ({ result: input }),
  },
});

harness.unloadTools(["newTool"]);
```

## API Reference

### Exports

| Export | Description |
|---|---|
| `defineTools(defs)` | Type-safe tool definition helper (identity function with inference) |
| `createHarness(tools, config?)` | Create a `ToolHarness` instance |
| `ToolHarness` | Core class: registry, dispatch, repair, meta-tool generation |
| `ToolRegistry` | Fuzzy-matching tool registry with Levenshtein resolution |
| `introspect` | Schema introspection utilities |
| `describe` | Description engine (signatures, prompt blocks, tool details) |
| `repair` | Repair pipeline (JSON fix, key normalize, type coerce, enum match, defaults, AI repair, structured errors) |

### `ToolHarness` methods

| Method | Returns | Description |
|---|---|---|
| `toMetaTools()` | `{ read, search, task }` | 3 AI SDK tools for meta-tool mode |
| `toDirectTools()` | `Record<string, Tool>` | One AI SDK tool per registered tool |
| `toHybridTools()` | `Record<string, Tool>` | Direct tools for `always` tasks + meta-tools for the rest |
| `repairHook(opts?)` | `RepairToolCallFn` | Error-recovery hook for `generateText` / `streamText` |
| `dispatch(category, input, ctx?)` | `Promise<unknown>` | Route a call to the correct tool |
| `repair(toolName, args)` | `Promise<RepairResult>` | Run the repair pipeline without executing |
| `repairJSON(raw)` | `object \| null` | Fix malformed JSON strings |
| `generatePromptBlock()` | `string` | Token-efficient description of all tools |
| `getToolDetail(name)` | `string` | Detailed description for one tool |
| `listToolSummaries()` | `string` | One-line signatures for all tools |
| `loadTools(defs)` | `void` | Register additional tools at runtime |
| `suggestToolChoice(ctx)` | `"auto" \| "required"` | Structural hint for `toolChoice` -- reduces false negatives on confirmation turns |
| `toCompiledTools(ctx, opts?)` | `CompileResult` | Turn-local tool surface from capability registry |
| `unloadTools(names)` | `void` | Remove tools by name |

For the full API reference with type signatures, see the [documentation](https://svilupp.github.io/tool-harness/).

## Documentation

Full documentation, guides, and examples are available at **[svilupp.github.io/tool-harness](https://svilupp.github.io/tool-harness/)**.

## License

[MIT](./LICENSE)
