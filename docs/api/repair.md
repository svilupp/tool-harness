---
layout: default
title: Repair Pipeline
---

# Repair Pipeline

tool-harness includes a 7-layer repair pipeline that automatically fixes malformed tool arguments before validation fails. Each layer addresses a different class of error, and layers run in sequence -- if an earlier layer fixes the issue, later layers see the corrected data.

## Pipeline Overview

```
Raw arguments
  |
  v
Layer 1: JSON Repair         -- fix syntax errors
  |
  v
Layer 2: Key Normalization    -- fix key names
  |
  v
Layer 3: Type Coercion        -- fix value types
  |
  v
Layer 4: Fuzzy Enum Matching  -- fix enum values (Levenshtein)
  |
  v
Layer 4a: Synonym Enum        -- fix enum values (synonym table)
  |
  v
Layer 4b: Semantic Enum       -- fix enum values (semantic matching)
  |
  v
Layer 5: Default Injection    -- fill missing optional fields
  |
  v
  Zod validation
  |
  +-- pass --> RepairResult { ok: true, data, repairs }
  |
  +-- fail --> Layer 6: AI Repair (if repairModel configured)
  |              |
  |              +-- pass --> RepairResult { ok: true }
  |              +-- fail --|
  |                         v
  +-- fail ----------> Layer 7: Structured Error
                         |
                         v
                       RepairResult { ok: false, error }
```

---

## Layer 1: JSON Repair

**Strategy:** `json_fix`

Fixes malformed JSON before arguments are parsed. Uses the [jsonrepair](https://github.com/josdejong/jsonrepair) library to handle:

- Unquoted keys and values
- Trailing commas
- Missing closing brackets/braces
- Single-quoted strings
- Comments in JSON

This layer runs via `harness.repairJSON()` and is also used in the repair hook when `toolCall.args` is a malformed string.

```ts
harness.repairJSON('{ path: "test.txt", }');
// => { path: "test.txt" }
```

---

## Layer 2: Key Normalization

**Strategy:** `key_normalize`

Fixes key name mismatches between the provided arguments and the schema:

- **Case correction**: `Path` becomes `path`, `FILE_NAME` becomes `fileName`
- **camelCase to snake_case**: `fileName` matches `file_name` and vice versa
- **Exact substring matching**: Finds the closest schema key for each unrecognized input key

```ts
// Schema expects: { filePath: string }
// Model sends:    { FilePath: "test.txt" }
// Repaired to:    { filePath: "test.txt" }
```

---

## Layer 3: Type Coercion

**Strategy:** `coerce`

Coerces values to match the expected schema types:

- **String to number**: `"42"` becomes `42`
- **String to boolean**: `"true"` becomes `true`, `"false"` becomes `false`
- **Number to string**: `42` becomes `"42"` when a string is expected
- **Boolean to string**: `true` becomes `"true"` when a string is expected

```ts
// Schema expects: { limit: z.number() }
// Model sends:    { limit: "10" }
// Repaired to:    { limit: 10 }
```

---

## Layer 4: Fuzzy Enum Matching

**Strategy:** `fuzzy_enum`

When a value does not exactly match a Zod enum, this layer uses [Levenshtein distance](https://en.wikipedia.org/wiki/Levenshtein_distance) (via the `fastest-levenshtein` library) to find the closest valid enum value.

```ts
// Schema expects: z.enum(["javascript", "typescript", "python"])
// Model sends:    { language: "typscript" }
// Repaired to:    { language: "typescript" }
```

The match threshold is based on the relative edit distance to avoid false positives on short strings.

---

## Layer 4a: Synonym Enum Matching

**Strategy:** `synonym_enum`

Catches paraphrases and common aliases via a pre-computed synonym lookup table. This handles cases where the model uses a semantically equivalent term that Levenshtein distance would not catch.

```ts
// Schema expects: z.enum(["js", "ts", "py"])
// Model sends:    { language: "javascript" }
// Repaired to:    { language: "js" }
```

---

## Layer 4b: Semantic Enum Matching

**Strategy:** `semantic_enum`

Handles natural-language descriptions that map to enum values. Uses semantic similarity to match free-form text to the closest enum option.

```ts
// Schema expects: z.enum(["asc", "desc"])
// Model sends:    { order: "ascending" }
// Repaired to:    { order: "asc" }
```

---

## Layer 5: Default Injection

**Strategy:** `default`

Fills in missing optional fields with their Zod-defined defaults. This layer runs after all other repairs so that defaults only apply to fields that were not provided by the model (and not fixed by earlier layers).

```ts
// Schema: z.object({ limit: z.number().default(10) })
// Model sends:    {}
// Repaired to:    { limit: 10 }
```

Repair actions from default injection are annotated but treated as non-meaningful -- they do not trigger the `_repairNote` annotation on results.

---

## Layer 6: AI Repair

**Strategy:** `ai_repair`

**Opt-in.** Only runs if a `repairModel` is configured in `HarnessConfig`. This layer sends the failed arguments, schema, and validation errors to an AI model and asks it to fix them.

```ts
const harness = createHarness(tools, {
  repairModel: openai("gpt-4o-mini"),
});
```

This is the only async-only layer. It runs after Zod validation fails and before structured error generation. If the AI-repaired arguments pass validation, they are returned as the result.

---

## Layer 7: Structured Error

When all repair layers fail and validation still does not pass, tool-harness builds a `StructuredToolError` with:

- Per-field issues (path, expected type, received value)
- Candidate values for enum mismatches
- Suggestions for fixing the call
- List of available tools (for tool-name errors)

This structured error is returned as `RepairResult.error` and is designed to be fed back to the model for self-correction.

```ts
{
  toolName: "writeFile",
  issues: [
    {
      path: "mode",
      expected: "'overwrite' | 'append'",
      received: "replace",
      candidates: ["overwrite", "append"],
    },
  ],
  suggestion: "Check enum values against the tool signature.",
  availableTools: ["readFile", "grep", "writeFile"],
}
```

---

## Using Repair Directly

You can run the repair pipeline without executing the tool:

```ts
const result = await harness.repair("writeFile", {
  Path: "out.txt",
  Content: 42,
  mode: "overrite",
});

if (result.ok) {
  console.log(result.data);
  // { path: "out.txt", content: "42", mode: "overwrite" }

  console.log(result.repairs);
  // [
  //   { field: "path", original: undefined, repaired: "out.txt", strategy: "key_normalize" },
  //   { field: "content", original: 42, repaired: "42", strategy: "coerce" },
  //   { field: "mode", original: "overrite", repaired: "overwrite", strategy: "fuzzy_enum" },
  // ]
}
```

## Repair Hook Integration

The repair hook wraps the pipeline for use with the AI SDK's `experimental_repairToolCall`:

```ts
const { text } = await generateText({
  model: yourModel,
  tools: harness.toMetaTools(),
  experimental_repairToolCall: harness.repairHook({ mode: "meta" }),
  maxSteps: 10,
  prompt: "...",
});
```

The hook intercepts two error types:

- **`AI_InvalidToolArgumentsError`**: Runs the repair pipeline on the malformed arguments.
- **`AI_NoSuchToolError`**: Resolves the tool name via fuzzy matching and optionally re-routes to meta-tools in hybrid mode.

If repair succeeds, the corrected tool call is returned and execution continues transparently. If repair fails, `null` is returned and the original error is surfaced to the model.
