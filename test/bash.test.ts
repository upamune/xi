import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ToolCalls } from "agentfs-sdk";
import type { Bash, BashExecResult } from "just-bash";
import { createBashTool } from "../src/tools/bash.js";

describe("BashTool", () => {
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

	test("should execute command and return result", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "output",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createBashTool(mockBash, mockTools);
		const result = await tool.execute({ command: "echo test" });

		expect(result.stdout).toBe("output");
		expect(result.exitCode).toBe(0);
		expect(result.command).toBe("echo test");
	});

	test("should return stderr on non-zero exit", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "",
					stderr: "command not found",
					exitCode: 127,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createBashTool(mockBash, mockTools);
		const result = await tool.execute({ command: "invalidcmd" });

		expect(result.exitCode).toBe(127);
		expect(result.stderr).toBe("command not found");
	});

	test("should pass cwd option", async () => {
		let capturedOptions: { cwd?: string } | undefined;
		mockBash = {
			exec: mock(async (_cmd: string, options?: { cwd?: string }): Promise<BashExecResult> => {
				capturedOptions = options;
				return {
					stdout: "",
					stderr: "",
					exitCode: 0,
					env: {},
				};
			}),
		} as unknown as Bash;

		const tool = createBashTool(mockBash, mockTools);
		await tool.execute({ command: "ls", cwd: "/home/user" });

		expect(capturedOptions?.cwd).toBe("/home/user");
	});

	test("should record tool call", async () => {
		mockBash = {
			exec: mock(
				async (): Promise<BashExecResult> => ({
					stdout: "output",
					stderr: "",
					exitCode: 0,
					env: {},
				})
			),
		} as unknown as Bash;

		const tool = createBashTool(mockBash, mockTools);
		await tool.execute({ command: "echo test" });

		expect(recordMock).toHaveBeenCalled();
		const call = recordMock.mock.calls[0];
		expect(call[0]).toBe("bash");
	});
});
