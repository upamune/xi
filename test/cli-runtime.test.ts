import { describe, expect, test } from "bun:test";
import { applyApiKeyOverride, resolveOutputMode, resolveSession } from "../src/cli-runtime.js";

describe("cli-runtime", () => {
	describe("resolveOutputMode", () => {
		test("should keep explicit mode when print is false", () => {
			expect(resolveOutputMode({ mode: "json", print: false })).toBe("json");
		});

		test("should force text mode when print is true", () => {
			expect(resolveOutputMode({ mode: "rpc", print: true })).toBe("text");
		});
	});

	describe("applyApiKeyOverride", () => {
		test("should set anthropic key", () => {
			const env: NodeJS.ProcessEnv = {};
			applyApiKeyOverride("anthropic", "ant-key", env);
			expect(env.ANTHROPIC_API_KEY).toBe("ant-key");
		});

		test("should set openai key", () => {
			const env: NodeJS.ProcessEnv = {};
			applyApiKeyOverride("openai", "oa-key", env);
			expect(env.OPENAI_API_KEY).toBe("oa-key");
		});

		test("should set kimi key", () => {
			const env: NodeJS.ProcessEnv = {};
			applyApiKeyOverride("kimi", "kimi-key", env);
			expect(env.KIMI_API_KEY).toBe("kimi-key");
		});
	});

	describe("resolveSession", () => {
		test("should use explicit session id", () => {
			const resolved = resolveSession({
				session: "abc123",
				resume: false,
				continue: false,
				availableSessions: [],
			});
			expect(resolved).toEqual({
				sessionId: "abc123",
				shouldResume: false,
			});
		});

		test("should pick latest session when resume is true", () => {
			const resolved = resolveSession({
				session: null,
				resume: true,
				continue: false,
				availableSessions: ["one", "two"],
			});
			expect(resolved).toEqual({
				sessionId: "two",
				shouldResume: true,
			});
		});

		test("should normalize .db session input", () => {
			const resolved = resolveSession({
				session: "/tmp/foo/bar.db",
				resume: true,
				continue: false,
				availableSessions: [],
			});
			expect(resolved).toEqual({
				sessionId: "bar",
				shouldResume: true,
			});
		});
	});
});
