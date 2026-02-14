# Tree Session Implementation Plan

## Overview

This document describes the implementation plan for adding tree-structured sessions to xi, based on the design from pi-mono's `SessionManager`.

## Current State vs Target State

### Current State (xi)

```
Session (SQLite via AgentFS)
├── fs: Filesystem
├── kv: KvStore  
└── tools: ToolCalls (audit log)

Agent (in-memory)
└── messages: ModelMessage[] (flat array)
```

**Problems:**
- Messages only in memory, lost on restart
- No branching capability
- Cannot navigate history

### Target State (pi-mono style)

```
Session (SQLite via AgentFS)
├── fs: Filesystem
├── kv: KvStore
├── tools: ToolCalls
└── session: SessionManager (NEW)

SessionManager
├── entries: SessionEntry[] (append-only JSONL)
├── leafId: string | null (current position)
└── byId: Map<string, SessionEntry>

Tree Structure:
  root
   └── msg1 (parentId: null)
        └── msg2 (parentId: msg1.id)
             ├── msg3 (parentId: msg2.id)  ← leaf (current)
             └── msg4 (parentId: msg2.id)  ← branch
```

## Phase 1: Data Structures

### 1.1 Session Header

```typescript
// src/agent/session-types.ts

export const CURRENT_SESSION_VERSION = 1;

export interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;  // ISO string for human-readable creation time
	cwd: string;
	parentSession?: string;  // For forked sessions
}
```

### 1.2 Entry Types

```typescript
export interface SessionEntryBase {
	id: string;
	parentId: string | null;
	timestamp: number;  // Unix epoch ms from Date.now()
}

export interface MessageEntry extends SessionEntryBase {
	type: "message";
	role: "user" | "assistant" | "toolResult";
	content: string | ContentBlock[];
	toolCalls?: ToolCall[];
	provider?: string;
	model?: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

export type SessionEntry = MessageEntry | ModelChangeEntry | CompactionEntry;
```

> **Note:** `timestamp` uses `number` (Unix epoch ms) for consistency with `Date.now()` and easy numeric comparison. The `SessionHeader.timestamp` uses ISO string for human-readable creation time.

### 1.3 Tree Node

```typescript
export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
}
```

## Phase 2: SessionManager Implementation

### 2.1 File: `src/agent/session-manager.ts`

```typescript
export class SessionManager {
	private sessionId: string;
	private sessionFile: string | undefined;
	private fileEntries: FileEntry[] = [];  // Header + entries
	private byId: Map<string, SessionEntry> = new Map();
	private leafId: string | null = null;
	private persist: boolean;

	constructor(options: { cwd: string; sessionDir?: string; persist: boolean });

	// Creation / Loading
	static create(cwd: string): SessionManager;
	static open(path: string): SessionManager;
	static continueRecent(cwd: string): SessionManager;
	static inMemory(cwd: string): SessionManager;

	// Appending (creates child of current leaf)
	appendMessage(message: Message): string;
	appendModelChange(provider: string, modelId: string): string;
	appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string;

	// Tree navigation
	getLeafId(): string | null;
	getLeafEntry(): SessionEntry | undefined;
	getEntry(id: string): SessionEntry | undefined;
	getChildren(parentId: string): SessionEntry[];
	getBranch(fromId?: string): SessionEntry[];
	getTree(): SessionTreeNode[];

	// Branching
	branch(branchFromId: string): void;  // Move leaf to earlier entry
	resetLeaf(): void;                    // Move leaf before all entries

	// Context building
	buildSessionContext(): { messages: Message[]; model: ModelInfo | null };

	// Access
	getHeader(): SessionHeader | null;
	getEntries(): SessionEntry[];
	getSessionId(): string;
	getSessionFile(): string | undefined;
}
```

### 2.2 Persistence Strategy

**Option A: JSONL within SQLite (Recommended)**

Store session entries as JSONL in a dedicated SQLite table:

```sql
CREATE TABLE session_entries (
	line_number INTEGER PRIMARY KEY,
	entry_json TEXT NOT NULL
);
```

**Rationale:**
- Keeps everything in one SQLite file (AgentFS compatible)
- JSONL format is append-friendly
- Easy to read line-by-line

**Option B: Separate JSONL File**

Store in `.xi/sessions/{id}.jsonl` alongside `{id}.db`.

**Decision:** Option A for simplicity and atomicity.

### 2.3 ID Generation

```typescript
function generateId(byId: { has(id: string): boolean }): string {
	for (let i = 0; i < 100; i++) {
		const id = randomUUID().slice(0, 8);  // 8 hex chars
		if (!byId.has(id)) return id;
	}
	return randomUUID();
}
```

## Phase 3: Agent Integration

### 3.1 Changes to `src/agent/index.ts`

**Key Change:** The `this.messages` array is **removed**. All message history comes from `SessionManager.buildSessionContext()`.

```typescript
export class Agent {
	private sessionManager: SessionManager;  // NEW: replaces this.messages
	private tools: ToolRegistry;
	private provider: LLMProvider;
	private config: AgentConfig;
	private abortController: AbortController | null = null;

	constructor(options: AgentOptions) {
		this.sessionManager = options.sessionManager;
	}

	async prompt(message: string, signal?: AbortSignal): Promise<AgentResponse> {
		this.abortController = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;

		// 1. Append user message to tree (becomes new leaf)
		this.sessionManager.appendMessage({
			role: "user",
			content: message,
		});

		// 2. Build messages from tree path (root → leaf)
		//    This is the CRITICAL integration: use context, not this.messages
		const context = this.sessionManager.buildSessionContext();
		const messages = context.messages;

		// 3. Stream LLM response using tree-derived messages
		const stream = await this.provider.streamText({
			messages,  // ← From tree, not in-memory array
			systemPrompt: this.config.systemPrompt,
			abortSignal: combinedSignal,
		});

		// 4. Process stream and tool calls...
		let content = "";
		for await (const chunk of stream.textStream) {
			if (combinedSignal.aborted) throw new Error("Aborted");
			content += chunk;
		}

		const result = await stream;
		const calls = (await result.toolCalls) ?? [];

		// 5. Execute tools if any...
		//    (tool execution logic unchanged)

		// 6. Append assistant response to tree
		this.sessionManager.appendMessage({
			role: "assistant",
			content,
			provider: this.provider.name,
			model: this.provider.model,
		});

		this.abortController = null;
		return { content, toolCalls: /* ... */ };
	}

	// NEW: Branch from history
	branchFrom(entryId: string): void {
		this.sessionManager.branch(entryId);
	}

	// NEW: Get tree for display
	getSessionTree(): SessionTreeNode[] {
		return this.sessionManager.getTree();
	}

	// REMOVED: getMessages() - use sessionManager.getBranch() instead
	// REMOVED: clearMessages() - use sessionManager.branch() or newSession()
}
```

### 3.1.1 Critical Integration Point

The **most important change** is that `prompt()` no longer maintains its own message array:

```typescript
// BEFORE (broken for tree sessions):
const stream = await this.provider.streamText({
	messages: this.messages,  // ← Ignores tree, loses branch context
	...
});

// AFTER (correct):
const context = this.sessionManager.buildSessionContext();
const stream = await this.provider.streamText({
	messages: context.messages,  // ← From tree path root→leaf
	...
});
```

Without this change:
- **Resumed sessions** would send empty history to the LLM
- **Branched sessions** would send stale linear history instead of the new branch path

### 3.2 Session Interface Update

```typescript
// src/agent/session.ts

export interface Session {
	id: string;
	path: string;
	fs: Filesystem;
	kv: KvStore;
	tools: ToolCalls;
	sessionManager: SessionManager;  // NEW
	close(): Promise<void>;
}
```

## Phase 4: CLI & TUI Updates

### 4.1 CLI Flags

```bash
xi                      # Start new session
xi-c                    # Continue most recent
xi-r                    # Resume (show picker)
xi--branch <entry-id>   # Start new branch from entry
```

### 4.2 TUI: Tree Navigation

Add keybindings for tree navigation:

```
Ctrl+O    Open tree browser
Ctrl+B    Branch from selection
j/k       Navigate tree
Enter     Select branch point
Esc       Cancel
```

### 4.3 Tree Browser Component

```typescript
// src/tui/tree-browser.ts

import { Tree } from '@mariozechner/pi-tui';

export class TreeBrowser {
	private tree: Tree<SessionTreeNode>;
	private selectedIndex: number = 0;

	constructor(
		private sessionManager: SessionManager,
		private onSelect: (entryId: string) => void
	) {
		this.tree = new Tree({
			data: this.buildTreeData(),
			render: this.renderNode.bind(this),
		});
	}

	private buildTreeData(): TreeNode<SessionTreeNode>[] {
		const roots = this.sessionManager.getTree();
		return roots.map(this.toTreeNode.bind(this));
	}

	private renderNode(node: SessionTreeNode): string {
		const entry = node.entry;
		const prefix = node.entry.id === this.sessionManager.getLeafId() 
			? '◆ ' 
			: '○ ';
		
		switch (entry.type) {
			case 'message':
				return `${prefix}${entry.role}: ${this.truncate(entry.content)}`;
			default:
				return `${prefix}[${entry.type}]`;
		}
	}
}
```

## Phase 5: Migration

### 5.1 Detection

```typescript
function detectSessionVersion(path: string): 'legacy' | 'tree' {
	// Check if session_entries table exists
	// Or check for .jsonl file
}
```

### 5.2 Migration Script

```typescript
async function migrateLegacySession(
	legacyPath: string,  // Old .db file
	newPath: string      // New .db file
): Promise<void> {
	// 1. Open legacy session
	// 2. Read messages from AgentFS kv store (if stored there)
	// 3. Create new SessionManager
	// 4. Append each message as tree entry
	// 5. Save new format
}
```

## Phase 6: Testing

### 6.1 Unit Tests

```typescript
// test/session-manager.test.ts

describe('SessionManager', () => {
	test('appends message as child of leaf', () => {
		const sm = SessionManager.inMemory('/test');
		const id1 = sm.appendMessage(userMsg);
		expect(sm.getLeafId()).toBe(id1);
		
		const id2 = sm.appendMessage(assistantMsg);
		expect(sm.getLeafId()).toBe(id2);
		expect(sm.getEntry(id2)?.parentId).toBe(id1);
	});

	test('branch creates sibling', () => {
		const sm = SessionManager.inMemory('/test');
		const id1 = sm.appendMessage(userMsg);
		const id2 = sm.appendMessage(assistantMsg);
		
		sm.branch(id1);
		const id3 = sm.appendMessage(alternativeResponse);
		
		expect(sm.getEntry(id3)?.parentId).toBe(id1);
		expect(sm.getChildren(id1)).toHaveLength(2);
	});

	test('getBranch returns path from root to leaf', () => {
		// ...
	});

	test('getTree returns full tree structure', () => {
		// ...
	});

	test('buildSessionContext returns correct messages', () => {
		// ...
	});
});
```

### 6.2 Integration Tests

```typescript
// test/agent-tree.test.ts

describe('Agent with tree session', () => {
	test('persists messages across restarts', async () => {
		const session = await createSession('test-1');
		const agent = await createAgent(session, tools);
		
		await agent.prompt('Hello');
		await session.close();
		
		const session2 = await loadSession('test-1');
		const agent2 = await createAgent(session2, tools);
		
		expect(agent2.getMessages().length).toBe(2);
	});

	test('branch creates alternative path', async () => {
		// ...
	});
});
```

## Implementation Order

1. **Week 1: Core Data Structures**
   - `session-types.ts`
   - `SessionManager` class (in-memory first)
   - Unit tests

2. **Week 2: Persistence**
   - JSONL-in-SQLite storage
   - File read/write
   - Migration detection

3. **Week 3: Agent Integration**
   - Update Agent to use SessionManager
   - Update Session interface
   - Integration tests

4. **Week 4: TUI**
   - Tree browser component
   - Keybindings
   - Visual feedback

5. **Week 5: Polish**
   - Migration script
   - Documentation
   - Edge cases

## API Summary

### SessionManager

```typescript
class SessionManager {
	// Factory methods
	static create(cwd: string): SessionManager;
	static open(path: string): SessionManager;
	static continueRecent(cwd: string): SessionManager;
	static inMemory(cwd: string): SessionManager;
	static list(cwd: string): Promise<SessionInfo[]>;

	// Append operations (returns entry ID)
	appendMessage(message: Message): string;
	appendModelChange(provider: string, modelId: string): string;
	appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string;

	// Tree traversal
	getLeafId(): string | null;
	getLeafEntry(): SessionEntry | undefined;
	getEntry(id: string): SessionEntry | undefined;
	getChildren(parentId: string): SessionEntry[];
	getBranch(fromId?: string): SessionEntry[];
	getTree(): SessionTreeNode[];

	// Branching
	branch(branchFromId: string): void;
	resetLeaf(): void;

	// Context
	buildSessionContext(): SessionContext;

	// Metadata
	getHeader(): SessionHeader | null;
	getEntries(): SessionEntry[];
	getSessionId(): string;
	getSessionFile(): string | undefined;
}
```

### Agent (Updated)

```typescript
class Agent {
	// Existing
	prompt(message: string): Promise<AgentResponse>;
	abort(): void;
	getMessages(): Message[];

	// NEW: Tree operations
	branchFrom(entryId: string): void;
	getSessionTree(): SessionTreeNode[];
	getCurrentLeafId(): string | null;
}
```

## Open Questions

1. **Compaction strategy**: When to auto-compact? Threshold-based like pi-mono?

2. **Branch summary**: Should we generate summaries when branching (like pi-mono's `branchWithSummary`)?

3. **Label system**: Should we support pi-mono's label system for bookmarks?

4. **Fork to new session**: Should we support creating a new session file from a branch?

## References

- pi-mono session-manager.ts: `z/pi-mono/packages/coding-agent/src/core/session-manager.ts`
- pi-mono agent-session.ts: `z/pi-mono/packages/coding-agent/src/core/agent-session.ts`
