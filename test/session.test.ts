import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	createSession,
	deleteSession,
	listSessions,
	loadSession,
	sessionExists,
} from "../src/agent/session.js";

describe("Session", () => {
	const tempDir = join("/tmp", `zi-session-test-${Date.now()}`);

	beforeEach(() => {
		if (!existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("createSession", () => {
		test("should create session with .zi/sessions/{id}.db path", async () => {
			const session = await createSession("test-session-1", tempDir);

			expect(session.id).toBe("test-session-1");
			expect(session.path).toBe(join(tempDir, ".zi/sessions/test-session-1.db"));
			expect(existsSync(session.path)).toBe(true);
		});

		test("should create sessions directory if not exists", async () => {
			await createSession("test-session-2", tempDir);

			expect(existsSync(join(tempDir, ".zi/sessions"))).toBe(true);
		});

		test("should return session with fs, kv, tools, and close", async () => {
			const session = await createSession("test-session-3", tempDir);

			expect(session.fs).toBeDefined();
			expect(session.kv).toBeDefined();
			expect(session.tools).toBeDefined();
			expect(typeof session.close).toBe("function");
		});

		test("should create different sessions with different IDs", async () => {
			const session1 = await createSession("session-a", tempDir);
			const session2 = await createSession("session-b", tempDir);

			expect(session1.path).not.toBe(session2.path);
			expect(existsSync(session1.path)).toBe(true);
			expect(existsSync(session2.path)).toBe(true);
		});
	});

	describe("loadSession", () => {
		test("should load existing session", async () => {
			const created = await createSession("loadable-session", tempDir);
			await created.close();

			const loaded = await loadSession("loadable-session", tempDir);

			expect(loaded.id).toBe("loadable-session");
			expect(loaded.path).toBe(created.path);
		});

		test("should throw for non-existent session", async () => {
			expect(loadSession("non-existent", tempDir)).rejects.toThrow(
				"Session not found: non-existent"
			);
		});

		test("should return session with all interface members", async () => {
			const created = await createSession("interface-session", tempDir);
			await created.close();

			const loaded = await loadSession("interface-session", tempDir);

			expect(loaded.fs).toBeDefined();
			expect(loaded.kv).toBeDefined();
			expect(loaded.tools).toBeDefined();
			expect(typeof loaded.close).toBe("function");
		});
	});

	describe("sessionExists", () => {
		test("should return true for existing session", async () => {
			await createSession("existing-session", tempDir);

			expect(sessionExists("existing-session", tempDir)).toBe(true);
		});

		test("should return false for non-existent session", () => {
			expect(sessionExists("non-existent-session", tempDir)).toBe(false);
		});

		test("should return false before creation and true after", async () => {
			expect(sessionExists("lifecycle-session", tempDir)).toBe(false);

			await createSession("lifecycle-session", tempDir);

			expect(sessionExists("lifecycle-session", tempDir)).toBe(true);
		});
	});

	describe("listSessions", () => {
		test("should return empty array when no sessions", () => {
			expect(listSessions(tempDir)).toEqual([]);
		});

		test("should return array of session IDs", async () => {
			await createSession("list-a", tempDir);
			await createSession("list-b", tempDir);
			await createSession("list-c", tempDir);

			const sessions = listSessions(tempDir);

			expect(sessions.sort()).toEqual(["list-a", "list-b", "list-c"].sort());
		});

		test("should only return .db files", async () => {
			await createSession("db-session", tempDir);

			const sessions = listSessions(tempDir);

			expect(sessions).toContain("db-session");
		});

		test("should handle non-existent sessions directory", () => {
			const nonExistentDir = join(tempDir, "non-existent");
			expect(listSessions(nonExistentDir)).toEqual([]);
		});
	});

	describe("deleteSession", () => {
		test("should remove session file", async () => {
			const session = await createSession("deletable-session", tempDir);
			expect(existsSync(session.path)).toBe(true);

			deleteSession("deletable-session", tempDir);

			expect(existsSync(session.path)).toBe(false);
		});

		test("should make sessionExists return false", async () => {
			await createSession("delete-check-session", tempDir);
			expect(sessionExists("delete-check-session", tempDir)).toBe(true);

			deleteSession("delete-check-session", tempDir);

			expect(sessionExists("delete-check-session", tempDir)).toBe(false);
		});

		test("should not throw when deleting non-existent session", () => {
			expect(() => deleteSession("non-existent-delete", tempDir)).not.toThrow();
		});

		test("should remove from listSessions result", async () => {
			await createSession("list-delete-a", tempDir);
			await createSession("list-delete-b", tempDir);

			deleteSession("list-delete-a", tempDir);

			const sessions = listSessions(tempDir);
			expect(sessions).toEqual(["list-delete-b"]);
		});
	});

	describe("Session interface", () => {
		test("should have working fs operations", async () => {
			const session = await createSession("fs-test", tempDir);

			await session.fs.writeFile("/test.txt", Buffer.from("hello"));

			const content = await session.fs.readFile("/test.txt");
			expect(content.toString()).toBe("hello");
		});

		test("should have working kv operations", async () => {
			const session = await createSession("kv-test", tempDir);

			await session.kv.set("key1", "value1");

			const value = await session.kv.get("key1");
			expect(value).toBe("value1");
		});

		test("should close without error", async () => {
			const session = await createSession("close-test", tempDir);

			await expect(session.close()).resolves.toBeUndefined();
		});
	});
});
