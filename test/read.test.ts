import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ToolCalls } from "agentfs-sdk";
import type { Bash, BashExecResult } from "just-bash";
import { createReadTool } from "../src/tools/read.js";

describe("ReadTool", () => {
	let mockBash: Bash;
	let mockTools: ToolCalls;
	let recordMock: ReturnType<typeof mock>;

	beforeEach(() => {
		recordMock = mock(async () => 1);
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

	test("should read file content", async () => {
		const fileContent = "Hello, World!";
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: fileContent,
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createReadTool(mockBash, mockTools);
		const result = await tool.execute({ path: "/test.txt" });

		expect(result.content).toBe(fileContent);
		expect(result.path).toBe("/test.txt");
	});

	test("should throw on read failure", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "",
					stderr: "File not found",
					exitCode: 1,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createReadTool(mockBash, mockTools);

		expect(tool.execute({ path: "/nonexistent.txt" })).rejects.toThrow(
			"Failed to read /nonexistent.txt"
		);
	});

	test("should use sed for offset/limit", async () => {
		const fileContent = "line1\nline2\nline3";
		let capturedCommand = "";
		mockBash = {
			exec: mock(async (cmd: string): Promise<BashExecResult> => {
				capturedCommand = cmd;
				return {
					stdout: fileContent,
					stderr: "",
					exitCode: 0,
					env: {},
				};
			}),
		} as unknown as Bash;

		const tool = createReadTool(mockBash, mockTools);
		await tool.execute({ path: "/test.txt", offset: 2, limit: 1 });

		expect(capturedCommand).toContain("sed -n '2,2p'");
	});

	test("should record tool call", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "content",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createReadTool(mockBash, mockTools);
		await tool.execute({ path: "/test.txt" });

		expect(recordMock).toHaveBeenCalled();
		const call = recordMock.mock.calls[0];
		expect(call[0]).toBe("read");
	});
});
