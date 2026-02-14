import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildPromptFromInputs,
	expandFileArgs,
	readStdinIfAvailable,
} from "../src/input-ingestion.js";

describe("input-ingestion", () => {
	test("should expand @file arguments", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xi-input-"));
		try {
			const file = join(dir, "prompt.txt");
			await writeFile(file, "from-file", "utf-8");
			const result = await expandFileArgs(["hello", "@prompt.txt"], dir);
			expect(result).toEqual(["hello", "from-file"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("should keep normal arguments as-is", async () => {
		const result = await expandFileArgs(["hello", "world"]);
		expect(result).toEqual(["hello", "world"]);
	});

	test("should read stdin when not tty", async () => {
		const stdin = {
			isTTY: false,
			async *[Symbol.asyncIterator]() {
				yield "hello ";
				yield "stdin";
			},
		} as unknown as NodeJS.ReadStream;
		const result = await readStdinIfAvailable(stdin);
		expect(result).toBe("hello stdin");
	});

	test("should ignore stdin when tty", async () => {
		const stdin = {
			isTTY: true,
			async *[Symbol.asyncIterator]() {
				yield "ignored";
			},
		} as unknown as NodeJS.ReadStream;
		const result = await readStdinIfAvailable(stdin);
		expect(result).toBeNull();
	});

	test("should build prompt from args and stdin", () => {
		expect(buildPromptFromInputs(["one", "two"], "three", " ")).toBe("one two three");
	});
});
