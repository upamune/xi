import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Filesystem, ToolCalls } from "agentfs-sdk";
import type { Bash, BashExecResult } from "just-bash";
import { createEditTool } from "../src/tools/edit.js";

describe("EditTool", () => {
	let mockBash: Bash;
	let mockFs: Filesystem;
	let mockTools: ToolCalls;
	let recordMock: ReturnType<typeof mock>;
	let writeFileMock: ReturnType<typeof mock>;

	beforeEach(() => {
		recordMock = mock(async () => 1);
		writeFileMock = mock(async () => {});
		mockFs = {
			writeFile: writeFileMock,
		} as unknown as Filesystem;
		mockTools = {
			record: recordMock,
			start: mock(async () => 1),
			success: mock(async () => {}),
			error: mock(async () => {}),
			get: mock(async () => undefined),
			getByName: mock(async () => []),
			getRecent: mock(async () => []),
			getStats: mock(async () => []),
		} as unknown as ToolCalls;
	});

	test("should replace single occurrence", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "Hello, World!",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createEditTool(mockBash, mockFs, mockTools);
		const result = await tool.execute({
			path: "/test.txt",
			oldString: "World",
			newString: "Universe",
		});

		expect(result.occurrences).toBe(1);
		expect(writeFileMock).toHaveBeenCalledWith("/test.txt", "Hello, Universe!", "utf-8");
	});

	test("should throw when text not found", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "Hello, World!",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createEditTool(mockBash, mockFs, mockTools);

		expect(
			tool.execute({
				path: "/test.txt",
				oldString: "NotFound",
				newString: "Replaced",
			})
		).rejects.toThrow("Text not found in /test.txt");
	});

	test("should throw when multiple occurrences without replaceAll", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "foo bar foo",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createEditTool(mockBash, mockFs, mockTools);

		expect(
			tool.execute({
				path: "/test.txt",
				oldString: "foo",
				newString: "baz",
			})
		).rejects.toThrow("Found 2 occurrences");
	});

	test("should replace all occurrences with replaceAll", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "foo bar foo",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createEditTool(mockBash, mockFs, mockTools);
		const result = await tool.execute({
			path: "/test.txt",
			oldString: "foo",
			newString: "baz",
			replaceAll: true,
		});

		expect(result.occurrences).toBe(2);
		expect(writeFileMock).toHaveBeenCalledWith("/test.txt", "baz bar baz", "utf-8");
	});

	test("should throw on read failure", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "",
					stderr: "Permission denied",
					exitCode: 1,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createEditTool(mockBash, mockFs, mockTools);

		expect(
			tool.execute({
				path: "/test.txt",
				oldString: "old",
				newString: "new",
			})
		).rejects.toThrow("Failed to read /test.txt");
	});
});
