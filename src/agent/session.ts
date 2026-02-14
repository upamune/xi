import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AgentFS, type Filesystem, type KvStore, type ToolCalls } from "agentfs-sdk";
import { SessionManager } from "./session-manager.js";

export interface Session {
	id: string;
	path: string;
	fs: Filesystem;
	kv: KvStore;
	tools: ToolCalls;
	sessionManager: SessionManager;
	close(): Promise<void>;
}

const SESSIONS_DIR = ".zi/sessions";

function getSessionsDir(baseDir?: string): string {
	return join(baseDir ?? process.cwd(), SESSIONS_DIR);
}

function getSessionPath(id: string, baseDir?: string): string {
	return join(getSessionsDir(baseDir), `${id}.db`);
}

async function ensureSessionsDir(baseDir?: string): Promise<void> {
	const dir = getSessionsDir(baseDir);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

export async function createSession(id: string, baseDir?: string): Promise<Session> {
	await ensureSessionsDir(baseDir);
	const path = getSessionPath(id, baseDir);
	const cwd = baseDir ?? process.cwd();

	const agentfs = await AgentFS.open({ path });
	const sessionManager = SessionManager.create(cwd);

	return {
		id,
		path,
		fs: agentfs.fs,
		kv: agentfs.kv,
		tools: agentfs.tools,
		sessionManager,
		close: () => agentfs.close(),
	};
}

export async function loadSession(id: string, baseDir?: string): Promise<Session> {
	const path = getSessionPath(id, baseDir);

	if (!existsSync(path)) {
		throw new Error(`Session not found: ${id}`);
	}

	const cwd = baseDir ?? process.cwd();
	const agentfs = await AgentFS.open({ path });
	const sessionManager = SessionManager.create(cwd);

	return {
		id,
		path,
		fs: agentfs.fs,
		kv: agentfs.kv,
		tools: agentfs.tools,
		sessionManager,
		close: () => agentfs.close(),
	};
}

export function sessionExists(id: string, baseDir?: string): boolean {
	const path = getSessionPath(id, baseDir);
	return existsSync(path);
}

export function listSessions(baseDir?: string): string[] {
	const dir = getSessionsDir(baseDir);
	if (!existsSync(dir)) {
		return [];
	}

	const files = readdirSync(dir);
	return files.filter((f) => f.endsWith(".db")).map((f) => f.replace(".db", ""));
}

export function deleteSession(id: string, baseDir?: string): void {
	const path = getSessionPath(id, baseDir);
	if (existsSync(path)) {
		unlinkSync(path);
	}
}
