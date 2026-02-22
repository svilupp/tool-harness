---
layout: default
title: Types Reference
---

# Types Reference

All types are exported from the `tool-harness` package:

```ts
import type {
  ToolDef,
  ToolDefs,
  ToolExecutionContext,
  HarnessConfig,
  RepairResult,
  RepairAction,
  StructuredToolError,
  FieldIssue,
  Visibility,
  Category,
} from "tool-harness";
```

---

## Visibility

```ts
type Visibility = "always" | "listed" | "hidden";
```

Controls how a tool appears in meta-tool descriptions:

| Value | Description |
|---|---|
| `"always"` | In hybrid mode, exposed as a direct tool (task category only). Always listed in meta-tool descriptions. |
| `"listed"` | Appears in meta-tool descriptions. Dispatched through meta-tools. |
| `"hidden"` | Not listed in meta-tool descriptions, but still dispatchable through meta-tools. Useful for tools the model should only discover via `read target="tools"`. |

## Category

```ts
type Category = "read" | "search" | "task";
```

Determines which meta-tool routes to this tool:

| Value | Meta-Tool | Description |
|---|---|---|
| `"read"` | `read` | Information retrieval by target (file read, API fetch, introspection) |
| `"search"` | `search` | Query-based search (grep, web search, database query) |
| `"task"` | `task` | Actions that change state (write file, run command, send request) |

---

## ToolDef

```ts
interface ToolDef<TInput = any, TOutput = any> {
  description: string;
  category: Category;
  visibility: Visibility;
  schema: z.ZodObject<any>;
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>;
  examples?: TInput[];
  priority?: number;
  toModelOutput?: (opts: { output: TOutput }) => { type: "text"; value: string };
}
```

Defines a single tool.

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | `string` | Yes | Human-readable description shown to the model |
| `category` | `Category` | Yes | Which meta-tool category this tool belongs to |
| `visibility` | `Visibility` | Yes | How this tool appears in meta-tool descriptions |
| `schema` | `z.ZodObject` | Yes | Zod schema for input validation and repair |
| `execute` | `Function` | Yes | The tool's implementation |
| `examples` | `TInput[]` | No | Example inputs for the AI SDK's `inputExamples` |
| `priority` | `number` | No | Priority for ordering in descriptions |
| `toModelOutput` | `Function` | No | Custom output formatter for `experimental_toModelOutput` |

## ToolDefs

```ts
type ToolDefs = Record<string, ToolDef>;
```

A record mapping tool names to their definitions. Used as input to `createHarness()` and `defineTools()`.

---

## ToolExecutionContext

```ts
interface ToolExecutionContext {
  toolCallId: string;
  experimental_context?: unknown;
  [key: string]: unknown;
}
```

Passed to tool `execute` functions with metadata about the current call.

| Field | Type | Description |
|---|---|---|
| `toolCallId` | `string` | Unique identifier for this tool call |
| `experimental_context` | `unknown` | AI SDK experimental context data |

---

## HarnessConfig

```ts
interface HarnessConfig {
  repairModel?: LanguageModel;
}
```

Configuration for the `ToolHarness`.

| Field | Type | Required | Description |
|---|---|---|---|
| `repairModel` | `LanguageModel` | No | AI model used for layer-6 AI repair. Any Vercel AI SDK `LanguageModel` works. |

---

## RepairResult

```ts
type RepairResult<T = Record<string, unknown>> =
  | { ok: true;  data: T;  repairs: RepairAction[] }
  | { ok: false; error: StructuredToolError };
```

Returned by `harness.repair()`. Discriminated union on `ok`:

- **`ok: true`**: Repair succeeded. `data` contains the fixed arguments. `repairs` lists what was changed.
- **`ok: false`**: Repair failed. `error` contains structured feedback for the model.

## RepairAction

```ts
interface RepairAction {
  field: string;
  original: unknown;
  repaired: unknown;
  strategy:
    | "json_fix"
    | "key_normalize"
    | "coerce"
    | "fuzzy_enum"
    | "synonym_enum"
    | "semantic_enum"
    | "default"
    | "ai_repair";
}
```

Describes a single repair that was applied to one field.

| Field | Type | Description |
|---|---|---|
| `field` | `string` | The field path that was repaired |
| `original` | `unknown` | The original value before repair |
| `repaired` | `unknown` | The value after repair |
| `strategy` | `string` | Which repair layer fixed this field |

**Strategy values:**

| Strategy | Repair Layer | Description |
|---|---|---|
| `"json_fix"` | Layer 1 | JSON syntax was repaired |
| `"key_normalize"` | Layer 2 | Key name was corrected (case, camelCase/snake_case) |
| `"coerce"` | Layer 3 | Value type was coerced (e.g., `"42"` to `42`) |
| `"fuzzy_enum"` | Layer 4 | Enum value was fuzzy-matched by Levenshtein distance |
| `"synonym_enum"` | Layer 4a | Enum value was matched via synonym table |
| `"semantic_enum"` | Layer 4b | Enum value was matched via semantic similarity |
| `"default"` | Layer 5 | Missing optional field was filled with its default |
| `"ai_repair"` | Layer 6 | AI model repaired the value |

---

## StructuredToolError

```ts
interface StructuredToolError {
  toolName: string;
  resolvedTo?: string;
  issues: FieldIssue[];
  suggestion?: string;
  availableTools?: string[];
}
```

Returned when repair fails. Provides structured feedback the model can use to self-correct.

| Field | Type | Description |
|---|---|---|
| `toolName` | `string` | The tool that was called |
| `resolvedTo` | `string` | If the tool name was fuzzy-matched, the resolved name |
| `issues` | `FieldIssue[]` | Per-field validation issues |
| `suggestion` | `string` | Human-readable suggestion for fixing the call |
| `availableTools` | `string[]` | List of valid tool names (for "no such tool" errors) |

## FieldIssue

```ts
interface FieldIssue {
  path: string;
  expected: string;
  received: string;
  candidates?: string[];
}
```

Describes a single field validation issue.

| Field | Type | Description |
|---|---|---|
| `path` | `string` | JSON path to the problematic field |
| `expected` | `string` | What the schema expected |
| `received` | `string` | What was actually received |
| `candidates` | `string[]` | Closest valid values (for enum mismatches) |
