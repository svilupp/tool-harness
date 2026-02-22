# ToolHarness: Technical Research & Architecture Design

## A Lightweight TypeScript Harness for AI SDK Tool Consolidation, Auto-Repair, and Resilient Execution

---

## 1. Problem Statement

You have ~20 tools exposed to an LLM via AI SDK. This creates several compounding problems:

- **Context bloat**: Each tool definition consumes tokens. At 20+ tools, 5-8% of context is wasted on tool schemas before a single user message.
- **Selection confusion**: Models make worse tool choices as the number of similar options grows. Empirically, tool-selection accuracy drops sharply past ~10 tools.
- **Argument fragility**: Models generate invalid arguments — wrong types, misspelled enum values, missing required fields — and the default behavior is either a crash or an expensive retry that pollutes message history.
- **No graceful degradation**: AI SDK's `experimental_repairToolCall` is a single hook with no layered repair strategy. BrainGrid documented how this creates "death loops" — the model retries the same bad input, the SDK rejects it, the conversation becomes unrecoverable.

The goal: **consolidate 20 tools into 3 meta-tools** (`search`, `read`, `task`) with a runtime dispatch layer that does progressive auto-repair of arguments before ever bouncing errors back to the LLM.

---

## 2. Prior Art & Key Learnings

### 2.1 BAML (BoundaryML)

BAML's core insight is **Schema-Aligned Parsing (SAP)** — instead of constraining the LLM's token generation (which only works with self-hosted models), let the model output freely, then parse/repair the result. Their compiler-generated parsers handle:

- Missing quotes around keys
- Trailing commas
- Type coercion (string `"30"` → number `30`)
- Junk text surrounding JSON
- Partial/incomplete responses

**Takeaway for ToolHarness**: Don't validate-then-reject. Parse-then-repair-then-validate. BAML proves this is 2-4x faster than strict JSON modes while being more accurate.

BAML also demonstrates the value of **declarative retry policies** — one-line config rather than hand-rolled exponential backoff. And their key architectural bet: prompts are functions with typed inputs and outputs.

### 2.2 STRAP Pattern (Single Tool Resource Action Pattern)

Alma Tuck's STRAP pattern consolidated 96 MCP tools into 10 by applying REST-style routing:

```
// Old: 96 individual tools
create_email_list(), get_email_list(), update_email_list(), ...

// STRAP: 10 domain tools
email(resource: "list", action: "create", name: "Newsletter")
email(resource: "sequence", action: "get", id: "uuid")
```

Results: ~80% context reduction, near-zero tool selection errors, works with every LLM. The pattern relies on LLMs' strong ability to generalize `resource + action` after a single example.

**Takeaway**: Your `task(name, {args})` interface is essentially STRAP applied with an even simpler mental model. The key refinement is: don't make the model learn resource/action vocabulary — just give it a task name that maps to the underlying tool.

### 2.3 Meta-Tool Pattern (Synaptic Labs)

Two registered tools provide access to many capabilities:

1. **Discovery tool** — lists all available agents/tools
2. **Execution tool** — runs the selected tool

This reduces token overhead by 85-95% by only loading schemas on demand. The LLM sees an overview, requests specific schemas when needed, then executes.

**Takeaway**: Progressive disclosure matters. Your 3 meta-tools should include enough description for the model to route correctly, but the detailed argument schemas for specific sub-tools can be loaded dynamically.

### 2.4 AI SDK's Existing Repair Infrastructure

AI SDK already has several relevant primitives:

- **`experimental_repairToolCall`** — a hook called when tool arguments fail validation. You can return corrected args without a new LLM call.
- **`dynamicTool()`** — tools where input/output types are determined at runtime. Separated from static tools to preserve type safety.
- **Two-layer validation** (BrainGrid pattern) — use `strict: true` for JSON syntax, then `safeParse` inside `execute()` for semantic validation. This prevents death loops by keeping control in your code.
- **`InvalidToolArgumentsError`**, **`NoSuchToolError`** — typed errors you can catch and handle specifically.
- **Tool input examples** — Anthropic natively supports showing the model concrete examples of correct tool inputs.

### 2.5 JSON Repair Libraries

The ecosystem has mature options:

| Library | Approach | Best For |
|---------|----------|----------|
| `jsonrepair` (josdejong) | Streaming + regular, handles all common LLM mistakes | Production use, large docs |
| `@isdk/json-repair` | **Schema-guided** repair — uses your JSON Schema to resolve ambiguities | Best match for ToolHarness |
| `jaison` | Single-pass tokenization, 100% success on malformed JSON | Speed-critical paths |
| `json-repair-js` | Extracts JSON from markdown blocks, surrounding text | LLM output preprocessing |

**Recommendation**: Use `jsonrepair` as the base layer (most battle-tested, streaming support), then apply schema-guided coercion via Zod transforms on top.

---

## 3. Architecture Design

### 3.1 The Three Meta-Tools

```typescript
// What the model sees (3 tools):

search(query: string, opts?: { scope?: string; limit?: number })
// "Find things. Use when you need to look something up."
// Backed by: searchUsers, searchDocs, searchProducts, queryDB, ...

read(target: string, opts?: { fields?: string[]; format?: string })
// "Read/get a specific resource by ID or path."
// Backed by: getUser, getDocument, getConfig, readFile, ...

task(name: string, args: Record<string, unknown>, opts?: { confirm?: boolean })
// "Do something. Execute an action by name."
// Backed by: sendEmail, createUser, updateRecord, deployService, ...
```

This maps to a natural cognitive model: **find → inspect → act**. Every tool interaction falls into one of these three categories.

### 3.2 Internal Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AI SDK Interface                       │
│              (3 tools: search / read / task)              │
└───────────┬──────────────┬──────────────┬────────────────┘
            │              │              │
            ▼              ▼              ▼
┌───────────────────────────────────────────────────────────┐
│                    ToolHarness Core                        │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  Router      │  │  Arg Repair  │  │  Registry       │  │
│  │             │  │  Pipeline     │  │                 │  │
│  │ • fuzzy     │  │              │  │ • tool defs     │  │
│  │   match     │  │ • JSON fix   │  │ • schemas       │  │
│  │ • alias     │  │ • coerce     │  │ • aliases       │  │
│  │   resolve   │  │ • defaults   │  │ • popularity    │  │
│  │ • popularity│  │ • fuzzy enum │  │ • categories    │  │
│  │   rank      │  │ • safeParse  │  │                 │  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Error Escalation Strategy               │  │
│  │                                                     │  │
│  │  Layer 1: JSON repair (jsonrepair)                  │  │
│  │  Layer 2: Type coercion (Zod coerce + transforms)   │  │
│  │  Layer 3: Fuzzy enum matching (Levenshtein)         │  │
│  │  Layer 4: Default injection (fill missing optionals)│  │
│  │  Layer 5: Return structured error to AI SDK         │  │
│  │           (only if layers 1-4 all fail)             │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### 3.3 Core Types

```typescript
import { z } from 'zod';

// Tool definition — what library consumers register
interface ToolDef<TInput = any, TOutput = any> {
  name: string;                          // canonical name
  aliases?: string[];                    // "send_email", "sendEmail", "email.send"
  category: 'search' | 'read' | 'task'; // which meta-tool routes here
  description: string;                   // for the model's routing context
  schema: z.ZodType<TInput>;            // input validation
  execute: (input: TInput) => Promise<TOutput>;

  // Optional metadata
  examples?: TInput[];                   // concrete input examples
  popularity?: number;                   // 0-1, for ranking suggestions
  tags?: string[];                       // additional routing hints
  timeout?: number;                      // ms
  retryable?: boolean;                   // whether LLM retry makes sense
  dangerLevel?: 'safe' | 'moderate' | 'destructive';
}

// What the repair pipeline produces
type RepairResult<T> =
  | { ok: true; data: T; repairs: RepairAction[] }
  | { ok: false; error: StructuredToolError };

interface RepairAction {
  field: string;
  original: unknown;
  repaired: unknown;
  strategy: 'json_fix' | 'coerce' | 'fuzzy_match' | 'default' | 'trim';
}

// Structured error returned to AI SDK for self-fix
interface StructuredToolError {
  toolName: string;
  resolvedTo?: string;      // if fuzzy-matched to a different tool
  issues: FieldIssue[];
  suggestion?: string;      // human-readable fix hint
  availableTools?: string[]; // for "did you mean?" on NoSuchTool
}

interface FieldIssue {
  path: string;
  expected: string;
  received: string;
  candidates?: string[];    // for enum mismatches, show valid values
}
```

---

## 4. Repair Pipeline (The Core Innovation)

The key insight: **most tool call failures are fixable without another LLM round-trip**. Each repair layer is fast (microseconds) and deterministic. Only truly ambiguous failures escalate to the model.

### Layer 1: JSON Repair

```typescript
import { jsonrepair } from 'jsonrepair';

function repairJSON(raw: string): object | null {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      // Handles: missing quotes, trailing commas, single quotes,
      // comments, markdown code blocks, truncated JSON
      const fixed = jsonrepair(raw);
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}
```

### Layer 2: Type Coercion via Zod

```typescript
// Build a "lenient" version of any Zod schema
function lenientSchema<T extends z.ZodType>(schema: T): z.ZodType {
  // Walk the schema tree and wrap leaf types with coercion
  if (schema instanceof z.ZodString) {
    return z.coerce.string();
  }
  if (schema instanceof z.ZodNumber) {
    // "30" → 30, "3.14" → 3.14
    return z.coerce.number();
  }
  if (schema instanceof z.ZodBoolean) {
    // "true" → true, "1" → true, "yes" → true
    return z.preprocess(
      (v) => {
        if (typeof v === 'string') {
          const lower = v.toLowerCase().trim();
          if (['true', '1', 'yes', 'on'].includes(lower)) return true;
          if (['false', '0', 'no', 'off'].includes(lower)) return false;
        }
        return v;
      },
      z.coerce.boolean()
    );
  }
  if (schema instanceof z.ZodEnum) {
    // Defer to Layer 3 (fuzzy matching) — handled separately
    return schema;
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, val] of Object.entries(schema.shape)) {
      shape[key] = lenientSchema(val as z.ZodType);
    }
    return z.object(shape);
  }
  return schema;
}
```

### Layer 3: Fuzzy Enum Matching

This is where tool name resolution AND argument enum repair happen.

```typescript
import { closest, distance } from 'fastest-levenshtein';

function fuzzyMatchEnum(
  value: string,
  validValues: string[],
  threshold: number = 0.6  // minimum similarity ratio
): { match: string; confidence: number } | null {
  // Normalize
  const normalized = value.toLowerCase().trim();
  const normalizedValues = validValues.map(v => v.toLowerCase());

  // Exact match (case-insensitive)
  const exactIdx = normalizedValues.indexOf(normalized);
  if (exactIdx !== -1) {
    return { match: validValues[exactIdx], confidence: 1.0 };
  }

  // Prefix match: "cre" → "create"
  const prefixMatches = validValues.filter(v =>
    v.toLowerCase().startsWith(normalized)
  );
  if (prefixMatches.length === 1) {
    return { match: prefixMatches[0], confidence: 0.9 };
  }

  // Levenshtein closest
  const best = closest(normalized, normalizedValues);
  const bestIdx = normalizedValues.indexOf(best);
  const dist = distance(normalized, best);
  const maxLen = Math.max(normalized.length, best.length);
  const similarity = 1 - (dist / maxLen);

  if (similarity >= threshold) {
    return { match: validValues[bestIdx], confidence: similarity };
  }

  // Substring containment: "email" matches "send_email"
  const containsMatches = validValues.filter(v =>
    v.toLowerCase().includes(normalized) ||
    normalized.includes(v.toLowerCase())
  );
  if (containsMatches.length === 1) {
    return { match: containsMatches[0], confidence: 0.7 };
  }

  return null;
}
```

### Layer 4: Default Injection

```typescript
function injectDefaults(
  partial: Record<string, unknown>,
  schema: z.ZodObject<any>
): Record<string, unknown> {
  const result = { ...partial };
  const shape = schema.shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (result[key] !== undefined) continue;

    const zs = fieldSchema as z.ZodType;

    // Check for Zod default
    if (zs instanceof z.ZodDefault) {
      result[key] = zs._def.defaultValue();
      continue;
    }

    // Check for optional — don't inject, just skip
    if (zs instanceof z.ZodOptional) continue;

    // Required field missing — this will surface as an error
  }

  return result;
}
```

### Layer 5: Structured Error (Last Resort)

Only reached when layers 1-4 can't fix the input. Returns a rich, structured error that helps the model self-correct on the next turn:

```typescript
function buildStructuredError(
  toolName: string,
  args: unknown,
  zodError: z.ZodError,
  registry: ToolRegistry
): StructuredToolError {
  return {
    toolName,
    issues: zodError.issues.map(issue => ({
      path: issue.path.join('.'),
      expected: issue.message,
      received: JSON.stringify(getNestedValue(args, issue.path)),
      candidates: issue.code === 'invalid_enum_value'
        ? (issue as any).options?.slice(0, 5)
        : undefined,
    })),
    suggestion: generateFixHint(zodError),
    availableTools: toolName
      ? undefined
      : registry.listToolNames().slice(0, 10),
  };
}

function generateFixHint(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Check all required fields.';

  if (first.code === 'invalid_enum_value') {
    return `"${first.path.join('.')}" must be one of: ${(first as any).options?.join(', ')}`;
  }
  if (first.code === 'invalid_type') {
    return `"${first.path.join('.')}" should be ${first.expected}, got ${first.received}`;
  }
  return `Fix field "${first.path.join('.')}": ${first.message}`;
}
```

---

## 5. Tool Registry & Runtime Loading

### 5.1 Registry Design

```typescript
class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private aliases = new Map<string, string>();      // alias → canonical name
  private popularity = new Map<string, number>();    // name → call count
  private categories = new Map<string, Set<string>>(); // category → tool names

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
    this.categories.get(tool.category)?.add(tool.name)
      ?? this.categories.set(tool.category, new Set([tool.name]));

    // Register aliases
    for (const alias of tool.aliases ?? []) {
      this.aliases.set(alias.toLowerCase(), tool.name);
    }

    // Also register common transformations of the name
    this.aliases.set(tool.name.toLowerCase(), tool.name);
    this.aliases.set(toSnakeCase(tool.name), tool.name);
    this.aliases.set(toCamelCase(tool.name), tool.name);
    this.aliases.set(toKebabCase(tool.name), tool.name);
  }

  resolve(nameOrAlias: string): ToolDef | null {
    const normalized = nameOrAlias.toLowerCase().trim();

    // 1. Exact match
    if (this.tools.has(nameOrAlias)) return this.tools.get(nameOrAlias)!;

    // 2. Alias match
    const canonical = this.aliases.get(normalized);
    if (canonical) return this.tools.get(canonical)!;

    // 3. Fuzzy match
    const allNames = [...this.tools.keys(), ...this.aliases.keys()];
    const fuzzy = fuzzyMatchEnum(normalized, allNames, 0.7);
    if (fuzzy) {
      const resolved = this.aliases.get(fuzzy.match) ?? fuzzy.match;
      return this.tools.get(resolved) ?? null;
    }

    return null;
  }

  // Rank tools for inclusion in meta-tool descriptions
  // Uses popularity (call frequency) + recency
  ranked(category: 'search' | 'read' | 'task'): ToolDef[] {
    const names = this.categories.get(category) ?? new Set();
    return [...names]
      .map(n => this.tools.get(n)!)
      .sort((a, b) => (this.popularity.get(b.name) ?? 0)
                     - (this.popularity.get(a.name) ?? 0));
  }

  recordCall(name: string): void {
    this.popularity.set(name, (this.popularity.get(name) ?? 0) + 1);
  }
}
```

### 5.2 Dynamic Tool Loading

```typescript
// Tools can be registered from files, plugins, or at runtime

// Pattern 1: File-based loading
import { readdirSync } from 'fs';
import { join } from 'path';

async function loadToolsFromDirectory(
  dir: string,
  registry: ToolRegistry
): Promise<void> {
  const files = readdirSync(dir).filter(f => f.endsWith('.tool.ts'));
  for (const file of files) {
    const mod = await import(join(dir, file));
    if (mod.default && mod.default.name && mod.default.schema) {
      registry.register(mod.default);
    }
  }
}

// Pattern 2: Fluent builder
const sendEmail = defineTool({
  name: 'send_email',
  aliases: ['sendEmail', 'email.send', 'mail'],
  category: 'task',
  description: 'Send an email to one or more recipients',
  schema: z.object({
    to: z.array(z.string().email()).describe('Recipient email addresses'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body (plain text or HTML)'),
    cc: z.array(z.string().email()).optional(),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  examples: [
    { to: ['alice@example.com'], subject: 'Hello', body: 'Hi there!' }
  ],
  execute: async (input) => {
    // ... actual implementation
    return { sent: true, messageId: 'abc123' };
  },
});

// Pattern 3: Runtime registration (e.g., from MCP servers)
harness.registerFromMCP(mcpClient, {
  categoryOverrides: {
    'list_*': 'search',
    'get_*': 'read',
    '*': 'task',
  }
});
```

### 5.3 Popularity-Based Ranking

Track tool usage to optimize the meta-tool descriptions:

```typescript
interface PopularityTracker {
  // Called after each successful tool execution
  record(toolName: string, context: {
    latency: number;
    success: boolean;
    repairsApplied: RepairAction[];
  }): void;

  // Returns tools ranked by weighted score
  rank(category: string): Array<{
    name: string;
    score: number;     // composite: frequency × success_rate × recency
    callCount: number;
    successRate: number;
    avgLatency: number;
  }>;

  // Use ranked data to build better meta-tool descriptions
  generateDescription(category: string, topN?: number): string;
}
```

The `generateDescription` method dynamically builds the tool description that's sent to the model, prioritizing frequently-used tools at the top:

```typescript
function generateDescription(category: string, topN: number = 10): string {
  const ranked = tracker.rank(category);
  const top = ranked.slice(0, topN);

  let desc = `Execute a ${category} operation. Available operations:\n\n`;

  // Most popular tools listed first (model attention is front-biased)
  for (const tool of top) {
    const def = registry.resolve(tool.name)!;
    desc += `• ${tool.name}: ${def.description}\n`;
  }

  if (ranked.length > topN) {
    desc += `\n... and ${ranked.length - topN} more. `;
    desc += `Use name="${ranked[topN].name}" etc.`;
  }

  return desc;
}
```

---

## 6. Integration with AI SDK

### 6.1 Creating the Three Meta-Tools

```typescript
import { tool, generateText } from 'ai';
import { z } from 'zod';

function createMetaTools(harness: ToolHarness) {
  return {
    search: tool({
      description: harness.generateDescription('search'),
      inputSchema: z.object({
        query: z.string().describe('What to search for'),
        scope: z.string().optional().describe('Narrow scope: e.g. "users", "docs"'),
        limit: z.number().optional().default(10),
      }),
      execute: async (input) => harness.dispatch('search', input),
    }),

    read: tool({
      description: harness.generateDescription('read'),
      inputSchema: z.object({
        target: z.string().describe('Resource ID, path, or name to read'),
        fields: z.array(z.string()).optional().describe('Specific fields to return'),
        format: z.enum(['json', 'text', 'summary']).optional().default('json'),
      }),
      execute: async (input) => harness.dispatch('read', input),
    }),

    task: tool({
      description: harness.generateDescription('task'),
      inputSchema: z.object({
        name: z.string().describe('Task/operation name'),
        args: z.record(z.unknown()).default({}).describe('Arguments for the task'),
        confirm: z.boolean().optional().default(false)
          .describe('Set true for destructive operations'),
      }),
      execute: async (input) => harness.dispatch('task', input),
    }),
  };
}

// Usage with AI SDK
const result = await generateText({
  model: anthropic('claude-sonnet-4-20250514'),
  tools: createMetaTools(harness),
  prompt: 'Send an email to alice@example.com about the meeting tomorrow',

  // Layered repair: harness handles most failures internally,
  // this catches anything that leaks through
  experimental_repairToolCall: async ({ toolCall, error }) => {
    if (error.name === 'InvalidToolArgumentsError') {
      const repaired = harness.attemptRepair(toolCall);
      if (repaired) return { ...toolCall, args: JSON.stringify(repaired) };
    }
    return null;
  },
});
```

### 6.2 The Dispatch Flow

```typescript
class ToolHarness {
  async dispatch(
    category: 'search' | 'read' | 'task',
    input: Record<string, unknown>
  ): Promise<unknown> {

    // For search/read: route by scope/target
    // For task: route by name
    const toolName = category === 'task'
      ? (input.name as string)
      : this.inferToolFromInput(category, input);

    // Step 1: Resolve tool (with fuzzy matching)
    const tool = this.registry.resolve(toolName);
    if (!tool) {
      return this.buildNotFoundResponse(toolName, category);
    }

    // Step 2: Extract and repair args
    const rawArgs = category === 'task' ? input.args : input;
    const repairResult = this.repair(rawArgs, tool);

    if (!repairResult.ok) {
      // Return structured error for model self-correction
      return {
        error: true,
        ...repairResult.error,
      };
    }

    // Step 3: Execute with timeout
    try {
      const result = await Promise.race([
        tool.execute(repairResult.data),
        timeout(tool.timeout ?? 30000),
      ]);

      // Track success
      this.registry.recordCall(tool.name);
      this.tracker.record(tool.name, {
        latency: Date.now() - start,
        success: true,
        repairsApplied: repairResult.repairs,
      });

      return result;
    } catch (execError) {
      if (tool.retryable !== false) {
        return {
          error: true,
          message: execError.message,
          retryable: true,
          suggestion: 'This operation failed at runtime. You may retry with the same or modified arguments.',
        };
      }
      throw execError;
    }
  }
}
```

---

## 7. Additional Features

### 7.1 Tool Description Compression

Reduce token usage in tool descriptions by using a compact format:

```typescript
function compressDescription(tools: ToolDef[]): string {
  // Instead of verbose prose, use a table-like format
  // Models parse this efficiently
  return tools.map(t => {
    const required = getRequiredFields(t.schema);
    const optional = getOptionalFields(t.schema);
    return `${t.name}(${required.join(', ')}${optional.length ? ` [, ${optional.join(', ')}]` : ''}) — ${t.description}`;
  }).join('\n');
}

// Output:
// send_email(to, subject, body [, cc, priority]) — Send an email
// create_user(name, email [, role]) — Create a new user account
```

### 7.2 Argument Key Normalization

Models often use slightly wrong key names:

```typescript
function normalizeKeys(
  input: Record<string, unknown>,
  schema: z.ZodObject<any>
): Record<string, unknown> {
  const schemaKeys = Object.keys(schema.shape);
  const result: Record<string, unknown> = {};

  for (const [inputKey, value] of Object.entries(input)) {
    // Exact match
    if (schemaKeys.includes(inputKey)) {
      result[inputKey] = value;
      continue;
    }

    // Case-insensitive match: "Subject" → "subject"
    const caseMatch = schemaKeys.find(
      k => k.toLowerCase() === inputKey.toLowerCase()
    );
    if (caseMatch) {
      result[caseMatch] = value;
      continue;
    }

    // camelCase ↔ snake_case: "emailAddress" → "email_address"
    const snaked = toSnakeCase(inputKey);
    const cameled = toCamelCase(inputKey);
    const formatMatch = schemaKeys.find(
      k => k === snaked || k === cameled
    );
    if (formatMatch) {
      result[formatMatch] = value;
      continue;
    }

    // Fuzzy match on key name
    const fuzzy = fuzzyMatchEnum(inputKey, schemaKeys, 0.75);
    if (fuzzy) {
      result[fuzzy.match] = value;
      continue;
    }

    // Unknown key — pass through (schema validation will catch it if needed)
    result[inputKey] = value;
  }

  return result;
}
```

### 7.3 Telemetry & Observability

```typescript
interface HarnessEvents {
  'tool:resolved': { input: string; resolved: string; fuzzy: boolean };
  'tool:repaired': { tool: string; repairs: RepairAction[] };
  'tool:failed': { tool: string; error: StructuredToolError };
  'tool:executed': { tool: string; latency: number; success: boolean };
  'tool:escalated': { tool: string; reason: string };
}

// Emitted so you can log, monitor, improve prompts
harness.on('tool:repaired', ({ tool, repairs }) => {
  console.log(`Auto-repaired ${tool}:`, repairs);
  // Feed into prompt improvement pipeline
});
```

### 7.4 Danger Level Gating

```typescript
// Destructive tools require explicit confirmation
if (tool.dangerLevel === 'destructive' && !input.confirm) {
  return {
    error: false,
    needsConfirmation: true,
    message: `"${tool.name}" is a destructive operation. ` +
             `Call again with confirm: true to proceed.`,
    preview: describeAction(tool, args),
  };
}
```

### 7.5 Schema-Derived Examples

Automatically generate input examples from Zod schemas for the model:

```typescript
function generateExample(schema: z.ZodObject<any>): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const zf = field as z.ZodType;
    if (zf instanceof z.ZodString) {
      example[key] = zf.description ?? `example_${key}`;
    } else if (zf instanceof z.ZodNumber) {
      example[key] = 1;
    } else if (zf instanceof z.ZodBoolean) {
      example[key] = true;
    } else if (zf instanceof z.ZodEnum) {
      example[key] = zf.options[0];
    } else if (zf instanceof z.ZodArray) {
      example[key] = [];
    }
  }
  return example;
}
```

---

## 8. Interface Feedback: `search / read / task`

Your proposed `task(name, {args}, {optional_args})` interface is strong. Here's my refined recommendation:

### Keep Three Tools

`search`, `read`, `task` is better than two or four:
- **Two is too few** — "search" and "do" conflates reading with acting; models need the read/act distinction for safety reasoning
- **Four+ fragments** attention and reintroduces selection ambiguity
- Three maps to the universal pattern: **discover → inspect → act**

### Flatten Optional Args

Don't separate `{args}` from `{optional_args}` — just use one `args` object. Zod handles required vs optional natively. Two arg bags confuses models:

```typescript
// ❌ Confusing for models
task("send_email", { to: "alice@example.com" }, { priority: "high" })

// ✅ Single args object, schema handles required/optional
task("send_email", { to: "alice@example.com", priority: "high" })
```

### Tool Name vs Description Matching

For `task(name, ...)`, the `name` field should support both exact tool names AND natural language descriptions:

```typescript
// All of these should resolve to the same tool:
task("send_email", { ... })
task("sendEmail", { ... })
task("email.send", { ... })
task("send an email", { ... })  // NL fallback via fuzzy + alias matching
```

---

## 9. Recommended Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `zod` | Schema definition, validation, type inference | ~50KB |
| `jsonrepair` | Fix malformed JSON from LLM output | ~25KB |
| `fastest-levenshtein` | Fuzzy string matching for tool/enum resolution | ~3KB |
| `ai` (AI SDK) | Integration target | peer dep |

**Total overhead**: ~78KB. Zero native dependencies. Works in Node, Bun, Deno, edge runtimes.

---

## 10. What to Build First (Priority Order)

1. **ToolRegistry + resolve()** with alias and fuzzy matching — this is the foundation
2. **Repair pipeline** (layers 1-5) — the core value proposition
3. **Three meta-tool factory** (`createMetaTools()`) — the AI SDK integration
4. **Popularity tracking** + dynamic description generation
5. **Telemetry events** — for observability and prompt improvement
6. **File-based tool loading** — for ergonomic DX
7. **MCP bridge** — register MCP tools into the harness automatically

---

## 11. Key Design Principles

1. **Repair before reject.** Every layer tries to fix the input before escalating. Only truly ambiguous failures reach the model.

2. **The model sees 3 tools. Your code sees 20.** The consolidation happens at the harness layer, completely transparent to the LLM.

3. **Structured errors, not string errors.** When you must escalate to the model, give it field-level diagnostics with valid alternatives — not "invalid input."

4. **Popularity is a feature.** Tools that are called more often should appear higher in descriptions. LLM attention is position-biased; put the most useful tools first.

5. **Zero config defaults, full control available.** `defineTool()` should require only `name`, `schema`, and `execute`. Everything else has sensible defaults.

6. **Runtime, not compile-time.** Tools are registered and resolved at runtime. No code generation step, no DSL, no build tool. Just TypeScript.