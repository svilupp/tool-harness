---
layout: default
title: Harness API Reference
---

# Harness API Reference

The `ToolHarness` class is the core of tool-harness. It manages a registry of tools, dispatches calls by category, and runs the repair pipeline on malformed arguments.

## Creating a Harness

### `createHarness(tools, config?)`

Factory function that creates a new `ToolHarness` instance.

```ts
import { createHarness } from "tool-harness";

const harness = createHarness(tools);
```

### `constructor(tools: ToolDefs, config?: HarnessConfig)`

```ts
import { ToolHarness } from "tool-harness";

const harness = new ToolHarness(tools, {
  repairModel: openai("gpt-4o-mini"), // optional
});
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `tools` | `ToolDefs` | Record of tool name to `ToolDef` objects |
| `config` | `HarnessConfig` | Optional configuration |
| `config.repairModel` | `LanguageModel` | AI model for layer-6 repair (optional) |

---

## Dispatch

### `dispatch(category, input, context?)`

Routes a tool call to the appropriate underlying tool based on category. Automatically runs the repair pipeline on arguments before execution.

```ts
const result = await harness.dispatch("task", {
  name: "writeFile",
  args: { path: "out.txt", content: "hello" },
});
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `category` | `"read" \| "search" \| "task"` | Tool category to dispatch to |
| `input` | `Record<string, unknown>` | Input arguments (shape depends on category) |
| `context` | `ToolExecutionContext` | Optional execution context with `toolCallId` |

**Category-specific input shapes:**

- **`task`**: `{ name: string, args: Record<string, unknown> }` -- Routes to the named task tool.
- **`read`**: `{ target: string, ...extraArgs }` -- Routes to a read tool or virtual path (`"tools"`, `"tools/<name>"`).
- **`search`**: Pass-through to the first registered search tool.

**Returns:** `Promise<unknown>` -- The result from the underlying tool, annotated with repair notes if arguments were adjusted.

---

## Repair

### `repair(toolName, args)`

Runs the full repair pipeline on the given arguments against the named tool's schema. Does not execute the tool.

```ts
const result = await harness.repair("writeFile", {
  Path: "out.txt",     // wrong case
  content: 42,         // wrong type
});

if (result.ok) {
  console.log(result.data);    // { path: "out.txt", content: "42" }
  console.log(result.repairs); // details of what was fixed
} else {
  console.log(result.error);   // structured error with field issues
}
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `toolName` | `string` | Name of the tool whose schema to validate against |
| `args` | `Record<string, unknown>` | Raw arguments to repair |

**Returns:** `Promise<RepairResult>` -- See [RepairResult](types#repairresult) type.

### `repairJSON(raw)`

Attempts to fix malformed JSON strings (unclosed brackets, trailing commas, unquoted keys, etc.) using the `jsonrepair` library.

```ts
const fixed = harness.repairJSON('{ path: "test.txt", }');
// { path: "test.txt" }
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `raw` | `string` | Malformed JSON string |

**Returns:** `Record<string, unknown> | null` -- Parsed object on success, `null` on failure.

---

## Description

### `generatePromptBlock()`

Generates a formatted text block describing all registered tools, suitable for inclusion in a system prompt.

```ts
const block = harness.generatePromptBlock();
```

**Returns:** `string` -- Multi-line prompt block with tool signatures grouped by category.

### `getToolDetail(name)`

Returns a detailed description of a single tool, including its full schema and examples.

```ts
const detail = harness.getToolDetail("writeFile");
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Tool name to describe |

**Returns:** `string` -- Detailed tool description, or an error message if the tool is not found.

### `listToolSummaries()`

Returns a newline-separated list of one-line tool signatures for all registered tools.

```ts
const summaries = harness.listToolSummaries();
```

**Returns:** `string` -- One signature per line.

---

## Dynamic Tool Management

### `loadTools(defs)`

Registers additional tools at runtime.

```ts
harness.loadTools({
  newTool: {
    description: "A dynamically added tool",
    category: "task",
    visibility: "listed",
    schema: z.object({ input: z.string() }),
    execute: async ({ input }) => `processed: ${input}`,
  },
});
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `defs` | `ToolDefs` | Record of tool definitions to register |

### `unloadTools(names)`

Removes tools from the registry at runtime.

```ts
harness.unloadTools(["newTool"]);
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `names` | `string[]` | Tool names to remove |

---

## AI SDK Integration

### `toMetaTools()`

Returns three AI SDK `tool()` objects (`read`, `search`, `task`) that consolidate all registered tools by category.

```ts
const { text } = await generateText({
  model: yourModel,
  tools: harness.toMetaTools(),
  prompt: "...",
});
```

**Returns:** `{ read, search, task }` -- Each is a standard AI SDK tool.

### `toDirectTools()`

Returns all registered tools as individual AI SDK `tool()` objects.

```ts
const tools = harness.toDirectTools();
// { readFile, grep, shellExec, ... }
```

**Returns:** `Record<string, Tool>` -- One AI SDK tool per registered tool definition.

### `toHybridTools()`

Returns a combination of directly-exposed tools (those with `visibility: "always"` and `category: "task"`) and meta-tools for everything else. Hidden tools are dispatchable through meta-tools but not listed in their descriptions.

```ts
const tools = harness.toHybridTools();
```

**Returns:** `Record<string, Tool>` -- Mix of direct tools and meta-tools.

### `repairHook(options?)`

Builds a repair hook function compatible with the AI SDK's `experimental_repairToolCall` option. Intercepts `AI_InvalidToolArgumentsError` and `AI_NoSuchToolError` and attempts to fix them using the repair pipeline.

```ts
const { text } = await generateText({
  model: yourModel,
  tools: harness.toMetaTools(),
  experimental_repairToolCall: harness.repairHook({ mode: "meta" }),
  prompt: "...",
});
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.mode` | `"direct" \| "meta" \| "hybrid"` | `"direct"` | Which tool mode is in use (affects how unknown tools are re-routed) |

**Returns:** An async function with signature `({ toolCall, tools, error }) => Promise<toolCall | null>`.

**Behavior:**

- **`AI_InvalidToolArgumentsError`**: Parses the arguments, runs the repair pipeline, and returns the fixed tool call.
- **`AI_NoSuchToolError`**: Resolves the tool name via fuzzy matching. In hybrid mode, reroutes listed/hidden task tools to the `task` meta-tool.
- Returns `null` if repair fails (the AI SDK will surface the original error to the model).
