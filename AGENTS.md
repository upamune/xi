# AGENTS.md

Coding agent instructions for the zi project.

## Project Overview

zi is a minimal, fully-trackable coding agent built with Bun + TypeScript. All operations (read/write/edit/bash) are logged to SQLite via AgentFS for complete auditability.

## Build Commands

```bash
bun run dev          # Run CLI in development mode
bun run build        # Build CLI to dist/
bun run test         # Run all tests
bun test path/to/test.ts  # Run a single test file
bun run typecheck    # Type check without emitting
bun run lint         # Check code with Biome
bun run format       # Format code with Biome
bun run check        # Format + typecheck (pre-commit hook)
```

## Code Style

### Formatting (Biome)

- **Indentation**: Tabs
- **Line width**: 100 characters
- **Quotes**: Double quotes for strings
- **Semicolons**: Always
- **Trailing commas**: ES5 style

### Imports

```typescript
// External imports first (alphabetically)
import { chalk } from "chalk";
import { AgentFS } from "agentfs-sdk";
import { Bash } from "just-bash";

// Internal imports second (use @/ alias)
import { Config } from "@/config/index.js";
import { Session } from "@/agent/session.js";
```

### Types

- Use TypeScript strict mode
- Prefer interfaces over types for object shapes
- Use `type` for unions, intersections, and utility types
- Always define return types for public functions

```typescript
// Good
interface Session {
  id: string;
  fs: AgentFS;
}

type ProviderName = "anthropic" | "openai" | "kimi";

// Public function with return type
export function createSession(id: string): Promise<Session>
```

### Naming Conventions

- **Files**: lowercase with hyphens (`tool-registry.ts`)
- **Interfaces**: PascalCase (`Session`, `LLMProvider`)
- **Functions**: camelCase (`createSession`, `executeTool`)
- **Constants**: SCREAMING_SNAKE_CASE (`DEFAULT_CONFIG`)
- **Private members**: underscore prefix (`_internal`)

### Error Handling

```typescript
// Throw descriptive errors
throw new Error(`Text not found in ${path}`);

// Catch and log to AgentFS for auditability
try {
  await tool.execute(params);
} catch (error) {
  await session.tools.record(tool.name, params, { error: error.message });
  return { error: error.message };
}
```

## Project Structure

```
src/
├── index.ts           # Entry point
├── cli.ts             # CLI argument parsing
├── agent/
│   ├── index.ts       # Agent core
│   ├── session.ts     # Session management
│   └── provider.ts    # LLM provider abstraction
├── tools/
│   ├── index.ts       # Tool registry
│   ├── read.ts        # Read tool (via Just Bash)
│   ├── write.ts       # Write tool (via AgentFS)
│   ├── edit.ts        # Edit tool (read → TS replace → write)
│   └── bash.ts        # Bash tool (via Just Bash)
├── tui/
│   └── index.ts       # Terminal UI (pi-tui)
└── config/
    └── index.ts       # Configuration management
```

## Key Architecture Points

1. **Tools**: All tools delegate to either Just Bash (`read`, `bash`) or AgentFS SDK (`write`). The `edit` tool reads via bash, replaces in TypeScript, then writes via AgentFS.

2. **Sessions**: Each session is a single SQLite file at `.zi/sessions/{id}.db`. Contains file system, tool logs, and key-value store.

3. **Providers**: Use Vercel AI SDK. Supported: `anthropic`, `openai`, `kimi`.

4. **Safety**: Just Bash is sandboxed with no host filesystem access. All writes go through AgentFS.

## Testing

- Use Bun's built-in test runner
- Place tests in `test/` directory or alongside source files as `.test.ts`
- Use descriptive test names

```typescript
import { test, expect } from "bun:test";

test("edit tool throws on non-unique text", async () => {
  const result = edit(path, "common", "new");
  expect(result).rejects.toThrow("Found 2 occurrences");
});
```

## Git Hooks

Pre-commit runs `bun run check` (format + typecheck).
Pre-push runs `bun run test`.

## Environment Variables

- `ZI_DIR`: Override config directory (default: `~/.zi`)
- `ANTHROPIC_API_KEY`: Anthropic API key
- `OPENAI_API_KEY`: OpenAI API key
- `KIMI_API_KEY`: Kimi API key

---

## Task Tracking (Beads)

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

### Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
