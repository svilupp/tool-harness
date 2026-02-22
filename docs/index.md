---
layout: default
title: Home
---

# tool-harness

**Consolidate AI tools into 3 meta-tools with auto-repair.**

tool-harness takes a flat list of AI SDK tool definitions and consolidates them into three category-based meta-tools (`read`, `search`, `task`) with a built-in 7-layer repair pipeline that automatically fixes malformed tool calls before they fail.

## Feature Highlights

| Feature | Description |
|---|---|
| **3 Meta-Tools** | Consolidate any number of tools into `read`, `search`, and `task` categories |
| **7-Layer Repair** | JSON fix, key normalization, type coercion, fuzzy enum, defaults, AI repair, structured errors |
| **Hybrid Mode** | Mix meta-tools with always-visible direct tools for maximum flexibility |
| **Repair Hook** | Drop-in `experimental_repairToolCall` hook for the Vercel AI SDK |
| **Dynamic Loading** | Add or remove tools at runtime with `loadTools()` / `unloadTools()` |
| **Zero Config** | Works out of the box -- just define your tools and create a harness |

## Quick Links

- [Getting Started](getting-started) -- Installation, first example, choosing a mode
- [Harness API Reference](api/harness) -- Full `ToolHarness` class documentation
- [Types Reference](api/types) -- All exported TypeScript types
- [Repair Pipeline](api/repair) -- Deep dive into the 7-layer auto-repair system

## Installation

```bash
bun install tool-harness
```

## Minimal Example

```ts
import { defineTools, createHarness } from "tool-harness";
import { generateText } from "ai";
import { z } from "zod";

const tools = defineTools({
  readFile: {
    description: "Read a file from disk",
    category: "read",
    visibility: "listed",
    schema: z.object({ path: z.string() }),
    execute: async ({ path }) => Bun.file(path).text(),
  },
  grep: {
    description: "Search file contents with a regex pattern",
    category: "search",
    visibility: "listed",
    schema: z.object({
      pattern: z.string(),
      path: z.string().optional(),
    }),
    execute: async ({ pattern, path }) => {
      /* ... */
    },
  },
  writeFile: {
    description: "Write content to a file",
    category: "task",
    visibility: "listed",
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

const harness = createHarness(tools);

const { text } = await generateText({
  model: yourModel,
  tools: harness.toMetaTools(),
  prompt: "Read the README and summarize it",
});
```

The model sees only three tools (`read`, `search`, `task`) instead of three separate tools. The harness routes calls to the correct underlying tool, repairing malformed arguments along the way.
