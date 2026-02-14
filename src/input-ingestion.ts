import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function expandFileArgs(
	args: string[],
	cwd: string = process.cwd()
): Promise<string[]> {
	const expanded: string[] = [];
	for (const arg of args) {
		if (!arg.startsWith("@") || arg === "@") {
			expanded.push(arg);
			continue;
		}
		const path = resolve(cwd, arg.slice(1));
		const content = await readFile(path, "utf-8");
		expanded.push(content);
	}
	return expanded;
}

export async function readStdinIfAvailable(
	stdin: NodeJS.ReadStream = process.stdin
): Promise<string | null> {
	if (stdin.isTTY) {
		return null;
	}
	let data = "";
	for await (const chunk of stdin) {
		data += String(chunk);
	}
	const trimmed = data.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function buildPromptFromInputs(
	promptArgs: string[],
	stdinInput: string | null,
	separator: string = "\n\n"
): string | null {
	const parts = promptArgs.filter((part) => part.length > 0);
	if (stdinInput) {
		parts.push(stdinInput);
	}
	if (parts.length === 0) {
		return null;
	}
	return parts.join(separator);
}
