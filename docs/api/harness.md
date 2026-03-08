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
| `config.repairPolicy` | `RepairPolicy` | Controls which repair layers run and when (optional) |
| `config.onEvent` | `(event: HarnessEvent) => void` | Callback for harness lifecycle events (optional) |

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

### `generatePromptBlock(options?)`

Generates a formatted text block describing all registered tools, suitable for inclusion in a system prompt.

```ts
const block = harness.generatePromptBlock();
const block = harness.generatePromptBlock({ style: "minimal" });
```

**Parameters:**

| Option | Type | Default | Description |
|---|---|---|---|
| `style` | `"minimal" \| "grouped" \| "grouped_with_breadth" \| "grouped_with_examples" \| "full"` | `"grouped_with_breadth"` | Prompt block style |
| `domainGroups` | `Record<string, string[]>` | (by category) | Custom tool groupings |
| `breadthExamples` | `Record<string, Example[]>` | -- | Usage examples for `grouped_with_examples` and `full` styles |

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

## Capability-Based Compilation

### `registerCapability(cap)`

Registers a capability (a tool paired with activation rules and domain metadata) for use with `toCompiledTools`.

```ts
harness.registerCapability({
  name: "addToCart",
  domain: "commerce",
  group: "cart",
  tool: addToCartDef,
  activationRules: [
    { type: "state_match", condition: (ctx) => ctx.state === "browsing" },
  ],
});
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `cap` | `Capability` | Capability definition with name, domain, group, tool, and activation rules |

### `toCompiledTools(context, options?)`

Compiles a turn-local tool surface from registered capabilities. Evaluates activation rules against the current conversation state, sorts by priority, and returns up to `maxTools` AI SDK tools.

```ts
const { tools, metadata } = harness.toCompiledTools({
  state: "browsing",
  activeHandles: ["cart-123"],
  turnNumber: 3,
  lastToolCalled: "searchProducts",
});
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `context` | `TurnContext` | Current conversation state |
| `options.maxTools` | `number` | Max tools to offer (default 8) |
| `options.fallbackMode` | `"strict" \| "permissive"` | Whether to fill remaining slots from inactive capabilities (default `"strict"`) |
| `options.provider` | `string` | Provider hint (`"openai"`, `"anthropic"`, `"google"`) |

**Returns:** `CompileResult` with:

- `tools` -- `Record<string, Tool>` of AI SDK tools for the current turn.
- `metadata.offeredTools` -- Names of tools included in the surface.
- `metadata.hiddenTools` -- Names of tools that exceeded `maxTools` and were excluded.
- `metadata.compileMs` -- Time spent compiling, in milliseconds.

---

## Tool Choice

### `suggestToolChoice(context)`

Suggests the appropriate `toolChoice` setting for the current turn. Uses a structural signal: if the assistant's last message ended with `?` and the user gave a short reply (8 words or fewer), returns `"required"` to force a tool call. Otherwise returns `"auto"`.

This addresses post-confirmation inaction, where the model asks a question, the user confirms, and the model still does not act. No keyword matching -- purely structural.

```ts
harness.suggestToolChoice({
  lastAssistantMessage: "Would you like me to add that to your cart?",
  lastUserMessage: "Yes, please",
  turnNumber: 3,
  lastToolCalled: null,
})
// => "required"
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `context.lastAssistantMessage` | `string?` | The assistant's previous message text |
| `context.lastUserMessage` | `string` | The user's current message |
| `context.turnNumber` | `number` | Current turn number (1-indexed) |
| `context.lastToolCalled` | `string?` | Name of the last tool that was called |

**Returns:** `"auto" | "required"`

**Usage with AI SDK:**

```ts
const toolChoice = harness.suggestToolChoice({
  lastAssistantMessage: messages.at(-2)?.content,
  lastUserMessage: userMessage,
  turnNumber,
  lastToolCalled,
});

const { text } = await generateText({
  model,
  tools: harness.toDirectTools(),
  toolChoice,
  prompt: userMessage,
});
```

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

---

## `ToolHarness` Methods Summary

| Method | Returns | Description |
|---|---|---|
| `dispatch(category, input, context?)` | `Promise<unknown>` | Route a tool call by category |
| `repair(toolName, args)` | `Promise<RepairResult>` | Run repair pipeline without executing |
| `repairJSON(raw)` | `Record \| null` | Fix malformed JSON strings |
| `generatePromptBlock(options?)` | `string` | Generate system prompt tool description block |
| `getToolDetail(name)` | `string` | Detailed description of a single tool |
| `listToolSummaries()` | `string` | One-line signatures for all tools |
| `loadTools(defs)` | `void` | Register additional tools at runtime |
| `unloadTools(names)` | `void` | Remove tools from the registry |
| `registerCapability(cap)` | `void` | Register a capability for compiled tool surfaces |
| `toCompiledTools(context, options?)` | `CompileResult` | Compile turn-local tool surface from capabilities |
| `suggestToolChoice(context)` | `"auto" \| "required"` | Suggest `toolChoice` based on conversation structure |
| `toMetaTools()` | `{ read, search, task }` | AI SDK tools consolidated by category |
| `toDirectTools()` | `Record<string, Tool>` | AI SDK tools, one per registered tool |
| `toHybridTools()` | `Record<string, Tool>` | Mix of direct and meta tools |
| `repairHook(options?)` | `Function` | AI SDK `experimental_repairToolCall` hook |
