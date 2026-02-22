---
layout: default
title: Getting Started
---

# Getting Started

## Installation

```bash
bun install tool-harness
```

tool-harness requires the Vercel AI SDK (`ai` package) and Zod v4 as peer dependencies:

```bash
bun install ai zod
```

## Quick Start

### 1. Define Your Tools

Use `defineTools` to create a typed tool definition object. Each tool specifies a `category`, `visibility`, Zod `schema`, and an `execute` function.

```ts
import { defineTools } from "tool-harness";
import { z } from "zod";

const tools = defineTools({
  readFile: {
    description: "Read a file by path",
    category: "read",
    visibility: "listed",
    schema: z.object({ path: z.string() }),
    execute: async ({ path }) => Bun.file(path).text(),
  },
  grep: {
    description: "Search files with a regex pattern",
    category: "search",
    visibility: "listed",
    schema: z.object({
      pattern: z.string(),
      scope: z.string().optional().default("."),
    }),
    execute: async ({ pattern, scope }) => {
      /* your search implementation */
    },
  },
  shellExec: {
    description: "Run a shell command",
    category: "task",
    visibility: "listed",
    schema: z.object({
      command: z.string(),
      timeout: z.number().optional().default(30000),
    }),
    execute: async ({ command }) => {
      const result = Bun.$`${command}`;
      return result.text();
    },
  },
});
```

### 2. Create a Harness

```ts
import { createHarness } from "tool-harness";

const harness = createHarness(tools);
```

Optionally pass a `repairModel` for AI-assisted repair (layer 6):

```ts
import { openai } from "@ai-sdk/openai";

const harness = createHarness(tools, {
  repairModel: openai("gpt-4o-mini"),
});
```

### 3. Use with generateText

```ts
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: harness.toMetaTools(),
  maxSteps: 10,
  prompt: "Find all TODO comments in the src directory",
});
```

## Meta-Tools vs Direct Mode

tool-harness offers three modes for exposing tools to an AI model:

### Meta-Tools Mode (`toMetaTools()`)

Consolidates all tools into three category-based meta-tools: `read`, `search`, and `task`. This is ideal when you have many tools and want to keep the model's tool list small.

```ts
const tools = harness.toMetaTools();
// { read, search, task }
```

**Pros:** Fewer tools for the model to reason about. Tool descriptions embed all available sub-tool signatures.

**Cons:** One extra layer of dispatch. The model must specify which sub-tool to call via the `name` or `target` field.

### Direct Mode (`toDirectTools()`)

Exposes every tool individually as a standard AI SDK tool. No meta-tool consolidation.

```ts
const tools = harness.toDirectTools();
// { readFile, grep, shellExec, ... }
```

**Pros:** Standard tool-calling interface. No dispatch overhead.

**Cons:** Can overwhelm the model when you have many tools.

### Hybrid Mode (`toHybridTools()`)

Combines both approaches. Tools with `visibility: "always"` and `category: "task"` are exposed directly; everything else goes through meta-tools. Tools with `visibility: "hidden"` are dispatchable but not listed in descriptions.

```ts
const tools = harness.toHybridTools();
// { alwaysVisibleTool, read, search, task }
```

**Pros:** Best of both worlds. Critical tools are always visible; the rest are consolidated.

### Repair Hook

In any mode, you can add the repair hook for automatic argument fixing:

```ts
const { text } = await generateText({
  model: yourModel,
  tools: harness.toMetaTools(),
  experimental_repairToolCall: harness.repairHook({ mode: "meta" }),
  prompt: "...",
});
```

## Next Steps

- [Harness API Reference](api/harness) -- Full method documentation for `ToolHarness`
- [Types Reference](api/types) -- All exported TypeScript types
- [Repair Pipeline](api/repair) -- How the 7-layer repair system works
