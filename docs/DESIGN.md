# xi Design Document

## Architecture Overview

```
xi/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # CLI argument parsing
│   ├── agent/
│   │   ├── index.ts          # Agent core
│   │   ├── session.ts        # Session management
│   │   └── provider.ts       # LLM provider abstraction
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── read.ts           # Read tool
│   │   ├── write.ts          # Write tool
│   │   ├── edit.ts           # Edit tool
│   │   └── bash.ts           # Bash tool
│   ├── tui/
│   │   └── index.ts          # TUI setup (pi-tui)
│   └── config/
│       ├── index.ts          # Config management
│       └── defaults.ts       # Default settings
├── docs/
│   └── DESIGN.md             # This file
├── package.json
├── tsconfig.json
└── README.md
```

## Core Components

### 1. Agent Core (`src/agent/`)

The agent core manages the LLM conversation loop and tool execution.

```typescript
interface Agent {
  provider: LLMProvider;
  session: Session;
  tools: ToolRegistry;
  
  prompt(message: string): Promise<void>;
  executeTool(name: string, params: object): Promise<ToolResult>;
}
```

**Responsibilities:**
- Stream LLM responses
- Parse tool calls
- Execute tools with AgentFS tracking
- Handle errors and retries

### 2. Session Management (`src/agent/session.ts`)

Session wraps AgentFS and provides:

```typescript
interface Session {
  fs: AgentFS;           // Filesystem via AgentFS
  kv: KVStore;           // Key-value store via AgentFS
  tools: ToolLog;        // Tool call history via AgentFS
  
  id: string;
  path: string;          // .xi/sessions/{id}.db
}
```

**Session lifecycle:**
1. `Session.create()` - Creates new `.db` file
2. `Session.load(id)` - Loads existing session
3. `Session.save()` - Explicit save (auto-saves by default)

### 3. LLM Provider (`src/agent/provider.ts`)

Abstraction over Vercel AI SDK providers:

```typescript
interface LLMProvider {
  name: string;
  stream(messages: Message[], tools: Tool[]): AsyncIterable<Response>;
}

// Supported providers
type ProviderName = 'anthropic' | 'openai' | 'kimi';
```

**Provider configuration:**
```typescript
const providers = {
  anthropic: () => anthropic('claude-sonnet-4-5'),
  openai: () => openai('gpt-4o'),
  kimi: () => openaiCompatible({ 
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-latest'
  }),
};
```

### 4. Tools (`src/tools/`)

All tools use Just Bash + AgentFS under the hood.

#### read.ts

```typescript
async function read(path: string, offset?: number, limit?: number) {
  // Build command
  let cmd = `cat "${path}"`;
  if (offset || limit) {
    const start = offset ?? 1;
    const end = limit ? start + limit - 1 : '$';
    cmd = `sed -n '${start},${end}p' "${path}"`;
  }
  
  // Execute via Just Bash
  const result = await bash.exec(cmd);
  
  // Log to AgentFS
  await session.tools.record('read', { path, offset, limit }, result.stdout);
  
  return result.stdout;
}
```

#### write.ts

```typescript
async function write(path: string, content: string) {
  // Use AgentFS directly (avoids escape issues)
  await session.fs.mkdir(dirname(path), { recursive: true });
  await session.fs.writeFile(path, content);
  
  // Log to AgentFS
  await session.tools.record('write', { path, size: content.length }, 'success');
  
  return `Wrote ${content.length} bytes to ${path}`;
}
```

#### edit.ts

```typescript
async function edit(path: string, oldText: string, newText: string) {
  // 1. Read via Just Bash
  const content = await read(path);
  
  // 2. Validate match
  if (!content.includes(oldText)) {
    throw new Error(`Text not found in ${path}`);
  }
  
  const occurrences = content.split(oldText).length - 1;
  if (occurrences > 1) {
    throw new Error(`Found ${occurrences} occurrences. Text must be unique.`);
  }
  
  // 3. Replace in TypeScript
  const newContent = content.replace(oldText, newText);
  
  // 4. Write via AgentFS
  await write(path, newContent);
  
  // 5. Log to AgentFS
  await session.tools.record('edit', { path, oldLen: oldText.length, newLen: newText.length }, 'success');
  
  // 6. Return diff
  return generateDiff(content, newContent);
}
```

#### bash.ts

```typescript
async function bash(command: string) {
  // Execute via Just Bash with AgentFS backend
  const result = await justBash.exec(command);
  
  // Log to AgentFS
  await session.tools.record('bash', { command }, {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  });
  
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}
```

### 5. Just Bash + AgentFS Integration

The key integration point:

```typescript
import { agentfs } from 'agentfs-sdk/just-bash';
import { createBashTool } from 'just-bash/ai';

async function createSession(id: string) {
  // Open AgentFS with session ID
  const fs = await agentfs({ id });
  
  // Create Just Bash with AgentFS backend
  const bash = new Bash({ fs });
  
  return { fs, bash };
}
```

All file operations in Just Bash now go through AgentFS:
- `cat file.txt` → reads from `.xi/sessions/{id}.db`
- `echo "hello" > file.txt` → writes to `.xi/sessions/{id}.db`
- `rm file.txt` → marks as deleted in `.xi/sessions/{id}.db`

### 6. TUI (`src/tui/`)

Uses `@mariozechner/pi-tui` for the interactive interface:

```typescript
import { TUI, Editor, Text, Markdown, ProcessTerminal } from '@mariozechner/pi-tui';

function createTUI(session: Session) {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  
  // Message area
  const messages = new Container();
  tui.addChild(messages);
  
  // Input editor
  const editor = new Editor(tui, theme);
  editor.onSubmit = async (text) => {
    await agent.prompt(text);
  };
  tui.addChild(editor);
  
  return tui;
}
```

**TUI Components:**
- Header: Session info, model, token usage
- Messages: Conversation history with markdown rendering
- Editor: Multi-line input with autocomplete
- Footer: Status line

## Data Flow

### User Input Flow

```
User types message
       │
       ▼
Editor.onSubmit()
       │
       ▼
Agent.prompt(message)
       │
       ▼
LLM Provider streams response
       │
       ├── Text content → Display in TUI
       │
       └── Tool call → Execute tool
              │
              ▼
         Tool execution (read/write/edit/bash)
              │
              ▼
         Just Bash / AgentFS
              │
              ▼
         Logged to .xi/sessions/{id}.db
              │
              ▼
         Return result to LLM
              │
              ▼
         Continue streaming...
```

### File Operation Flow

```
Tool called (e.g., read)
       │
       ▼
Build bash command
       │
       ▼
justBash.exec('cat path')
       │
       ▼
Just Bash reads from AgentFS
       │
       ▼
AgentFS reads from SQLite
       │
       ▼
Return content
       │
       ▼
session.tools.record() logs the call
       │
       ▼
Return to LLM
```

## Configuration

### Global Config (`~/.xi/settings.json`)

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "theme": "dark",
  "thinking": "medium"
}
```

### Project Config (`.xi/settings.json`)

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "contextFiles": ["AGENTS.md"]
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `XI_DIR` | Override config directory (default: `~/.xi`) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `KIMI_API_KEY` | Kimi API key |

## CLI Commands

```bash
xi                     # Start interactive mode
xi-c                   # Continue last session
xi-r                   # Resume session (selector)
xi--no-session         # Ephemeral mode (no save)
xi--provider openai    # Use specific provider
xi--model gpt-4o       # Use specific model
xi-p "message"         # Print mode (non-interactive)
xi--help               # Show help
```

## Session File Format

Session files are SQLite databases managed by AgentFS:

```sql
-- File system tables (managed by AgentFS)
CREATE TABLE files (...);
CREATE TABLE directories (...);

-- Tool call log
CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY,
  timestamp DATETIME,
  tool TEXT,
  params JSON,
  result JSON
);

-- Key-value store
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value JSON
);
```

## Error Handling

### Tool Errors

```typescript
try {
  await tool.execute(params);
} catch (error) {
  // Log error to AgentFS
  await session.tools.record(tool.name, params, { error: error.message });
  
  // Return error to LLM for recovery
  return { error: error.message };
}
```

### Provider Errors

```typescript
try {
  await provider.stream(messages);
} catch (error) {
  if (error.code === 'rate_limit') {
    await sleep(60000);
    return retry();
  }
  if (error.code === 'context_length') {
    return compactAndRetry();
  }
  throw error;
}
```

## Future Extensions

xiis designed to be extensible:

1. **Skills** - Markdown files with instructions (like pi)
2. **Extensions** - TypeScript plugins for custom tools
3. **MCP Support** - Via extension (not built-in)
4. **Multi-agent** - Session forking and sub-agents

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `bun` | ^1.0 | Runtime |
| `ai` | ^4.0 | Vercel AI SDK |
| `just-bash` | ^0.x | Sandboxed bash |
| `agentfs-sdk` | ^0.x | SQLite filesystem |
| `@mariozechner/pi-tui` | ^0.x | Terminal UI |
| `chalk` | ^5.0 | Terminal colors |

## Testing Strategy

1. **Unit Tests** - Tool execution, text matching
2. **Integration Tests** - Just Bash + AgentFS integration
3. **E2E Tests** - Full agent conversations

```bash
bun test                 # Run all tests
bun test:unit            # Unit tests only
bun test:integration     # Integration tests
```

## Performance Considerations

1. **Streaming** - Stream LLM responses for perceived speed
2. **Caching** - AgentFS caches frequently accessed files
3. **Diff Rendering** - TUI only re-renders changed lines
4. **Lazy Loading** - Load session history on demand

## Security Model

1. **Sandboxed Execution** - Just Bash has no host access
2. **API Key Protection** - Never logged to AgentFS
3. **Path Sanitization** - All paths resolved within session
4. **No Network by Default** - Opt-in for curl access
