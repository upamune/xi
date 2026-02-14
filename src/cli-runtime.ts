import { basename } from "node:path";
import type { CliArgs } from "./cli.js";

export type OutputMode = "text" | "json" | "rpc";

export function resolveOutputMode(args: Pick<CliArgs, "mode" | "print">): OutputMode {
	if (args.print) {
		return "text";
	}
	return args.mode;
}

export function applyApiKeyOverride(
	provider: string,
	apiKey: string | null,
	env: NodeJS.ProcessEnv = process.env
): void {
	if (!apiKey) {
		return;
	}
	if (provider === "anthropic") {
		env.ANTHROPIC_API_KEY = apiKey;
		return;
	}
	if (provider === "openai") {
		env.OPENAI_API_KEY = apiKey;
		return;
	}
	if (provider === "kimi") {
		env.KIMI_API_KEY = apiKey;
	}
}

export interface SessionResolutionInput {
	session: string | null;
	resume: boolean;
	continue: boolean;
	availableSessions: string[];
}

export interface SessionResolution {
	sessionId: string | null;
	shouldResume: boolean;
}

export function resolveSession(input: SessionResolutionInput): SessionResolution {
	const shouldResume = input.resume || input.continue;
	if (input.session) {
		return {
			sessionId: normalizeSession(input.session),
			shouldResume,
		};
	}
	if (!shouldResume) {
		return {
			sessionId: null,
			shouldResume: false,
		};
	}
	const lastSession = input.availableSessions[input.availableSessions.length - 1] ?? null;
	return {
		sessionId: lastSession,
		shouldResume: true,
	};
}

function normalizeSession(value: string): string {
	const name = basename(value);
	if (name.endsWith(".db")) {
		return name.slice(0, -3);
	}
	return name;
}
