import {
	type Component,
	Container,
	Editor,
	type EditorTheme,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	type OverlayHandle,
	ProcessTerminal,
	TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import type { ModelMessage } from "ai";
import type { Agent, AgentResponse } from "@/agent/index.js";

export interface TuiOptions {
	sessionId: string;
	model: string;
	provider: string;
}

export interface MessageItem {
	role: "user" | "assistant";
	content: string;
	toolCalls?: Array<{
		name: string;
		args: Record<string, unknown>;
	}>;
}

interface StatusState {
	mode: "ready" | "busy" | "error" | "info";
	text: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const DEFAULT_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text: string) => `\x1b[1;38;5;111m${text}\x1b[0m`,
	link: (text: string) => `\x1b[4;38;5;75m${text}\x1b[0m`,
	linkUrl: (text: string) => `\x1b[2;38;5;75m${text}\x1b[0m`,
	code: (text: string) => `\x1b[38;5;221m${text}\x1b[0m`,
	codeBlock: (text: string) => `\x1b[38;5;252m${text}\x1b[0m`,
	codeBlockBorder: (text: string) => `\x1b[2;38;5;244m${text}\x1b[0m`,
	quote: (text: string) => `\x1b[2;38;5;250m${text}\x1b[0m`,
	quoteBorder: (text: string) => `\x1b[2;38;5;244m${text}\x1b[0m`,
	hr: (text: string) => `\x1b[2;38;5;244m${text}\x1b[0m`,
	listBullet: (text: string) => `\x1b[38;5;220m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	italic: (text: string) => `\x1b[3m${text}\x1b[0m`,
	strikethrough: (text: string) => `\x1b[9m${text}\x1b[0m`,
	underline: (text: string) => `\x1b[4m${text}\x1b[0m`,
};

const DEFAULT_EDITOR_THEME: EditorTheme = {
	borderColor: (str: string) => `\x1b[38;5;117m${str}\x1b[0m`,
	selectList: {
		selectedPrefix: (str: string) => `\x1b[48;5;24;38;5;255m${str}\x1b[0m`,
		selectedText: (str: string) => `\x1b[48;5;24;38;5;255m${str}\x1b[0m`,
		description: (str: string) => `\x1b[2;38;5;252m${str}\x1b[0m`,
		scrollInfo: (str: string) => `\x1b[2;38;5;245m${str}\x1b[0m`,
		noMatch: (str: string) => `\x1b[2;38;5;245m${str}\x1b[0m`,
	},
};

class Header implements Component {
	private sessionId: string;
	private model: string;
	private provider: string;
	private inFlight = false;

	constructor(options: TuiOptions) {
		this.sessionId = options.sessionId;
		this.model = options.model;
		this.provider = options.provider;
	}

	setInFlight(inFlight: boolean): void {
		this.inFlight = inFlight;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) {
			return [""];
		}

		const left = this.inFlight ? "\x1b[1;38;5;118mzi ● live\x1b[0m" : "\x1b[1;38;5;117mzi\x1b[0m";
		const right = `\x1b[2;38;5;252m${this.provider}/${this.model}\x1b[0m`;
		const session = `\x1b[2;38;5;248msession ${this.sessionId}\x1b[0m`;
		return [
			joinSides(left, right, width),
			truncateToWidth(session, width),
			truncateToWidth("\x1b[2;38;5;240m─\x1b[0m".repeat(width), width),
		];
	}
}

class ConversationArea implements Component {
	private messages: MessageItem[] = [];

	addMessage(message: MessageItem): void {
		this.messages.push(message);
	}

	clear(): void {
		this.messages = [];
	}

	count(): number {
		return this.messages.length;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) {
			return [""];
		}

		if (this.messages.length === 0) {
			return [
				truncateToWidth("", width),
				truncateToWidth("\x1b[2;38;5;245mAsk anything. Use Shift+Enter for newline.\x1b[0m", width),
				truncateToWidth("\x1b[2;38;5;245mCtrl+G: help  Ctrl+L: clear chat\x1b[0m", width),
				truncateToWidth("", width),
			];
		}

		const lines: string[] = [];
		for (const message of this.messages) {
			lines.push(...this.renderMessage(message, width));
		}
		return lines;
	}

	private renderMessage(message: MessageItem, width: number): string[] {
		const lines: string[] = [];
		const roleLabel =
			message.role === "user" ? "\x1b[1;38;5;121mYOU\x1b[0m" : "\x1b[1;38;5;228mASSISTANT\x1b[0m";
		const borderColor = message.role === "user" ? "\x1b[38;5;36m" : "\x1b[38;5;178m";

		lines.push(truncateToWidth(`${borderColor}╭─\x1b[0m ${roleLabel}`, width));

		const innerWidth = Math.max(6, width - 4);
		const body = this.renderBody(message, innerWidth);
		for (const line of body) {
			lines.push(truncateToWidth(`${borderColor}│\x1b[0m ${line}`, width));
		}

		if (message.toolCalls && message.toolCalls.length > 0) {
			const tools = message.toolCalls
				.map((tool) => formatToolCall(tool.name, tool.args))
				.join("  ·  ");
			lines.push(
				truncateToWidth(`${borderColor}│\x1b[0m \x1b[2;38;5;245mtools: ${tools}\x1b[0m`, width)
			);
		}

		lines.push(truncateToWidth(`${borderColor}╰─\x1b[0m`, width));
		lines.push("");
		return lines;
	}

	private renderBody(message: MessageItem, width: number): string[] {
		if (message.role === "assistant") {
			const markdown = new Markdown(message.content, 0, 0, DEFAULT_MARKDOWN_THEME);
			const rendered = markdown.render(width);
			return rendered.length > 0 ? rendered : [""];
		}

		const wrapped = wrapTextWithAnsi(message.content, width);
		return wrapped.length > 0 ? wrapped : [""];
	}
}

class PromptHint implements Component {
	private disabled = false;

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) {
			return [""];
		}
		const prompt = this.disabled
			? "\x1b[2;38;5;245mWaiting for model... (Ctrl+C to cancel)\x1b[0m"
			: "\x1b[2;38;5;245mEnter: send  Shift+Enter: newline  Ctrl+C: exit  Ctrl+G: help\x1b[0m";
		return [truncateToWidth(prompt, width)];
	}
}

class StatusBar implements Component {
	private state: StatusState = { mode: "ready", text: "Ready" };
	private spinner = "";

	setStatus(state: StatusState): void {
		this.state = state;
	}

	setSpinner(spinner: string): void {
		this.spinner = spinner;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) {
			return [""];
		}
		const modeStyled =
			this.state.mode === "busy"
				? "\x1b[1;30;48;5;215m BUSY \x1b[0m"
				: this.state.mode === "error"
					? "\x1b[1;37;48;5;124m ERROR \x1b[0m"
					: this.state.mode === "info"
						? "\x1b[1;30;48;5;151m INFO \x1b[0m"
						: "\x1b[1;30;48;5;153m READY \x1b[0m";
		const spinner = this.state.mode === "busy" && this.spinner ? ` ${this.spinner}` : "";
		const text = `${modeStyled}${spinner} ${this.state.text}`;
		return [
			`\x1b[48;5;236m${truncateToWidth(`${text}${" ".repeat(width)}`, width)}\x1b[0m`,
			truncateToWidth(
				"\x1b[2;38;5;244mCtrl+L clear chat  Ctrl+D exit when input empty\x1b[0m",
				width
			),
		];
	}
}

class HelpOverlay implements Component {
	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(28, width);
		const inner = Math.max(10, w - 4);
		const title = "\x1b[1;38;5;117mKeyboard Shortcuts\x1b[0m";
		const rows = [
			"Enter            Send message",
			"Shift+Enter      Insert newline",
			"Ctrl+C           Cancel while running / exit when idle",
			"Ctrl+D           Exit when editor is empty",
			"Ctrl+L           Clear visible chat messages",
			"Ctrl+G           Toggle this help",
			"Esc              Close this dialog",
		];
		const lines = [
			`\x1b[38;5;111m╭${"─".repeat(Math.max(1, w - 2))}╮\x1b[0m`,
			`\x1b[38;5;111m│\x1b[0m ${truncateToWidth(title, inner, "", true)} \x1b[38;5;111m│\x1b[0m`,
			`\x1b[38;5;111m├${"─".repeat(Math.max(1, w - 2))}┤\x1b[0m`,
		];

		for (const row of rows) {
			lines.push(
				`\x1b[38;5;111m│\x1b[0m ${truncateToWidth(row, inner, "", true)} \x1b[38;5;111m│\x1b[0m`
			);
		}

		lines.push(`\x1b[38;5;111m╰${"─".repeat(Math.max(1, w - 2))}╯\x1b[0m`);
		return lines;
	}
}

export class ZiTui {
	private tui: TUI;
	private header: Header;
	private conversationArea: ConversationArea;
	private promptHint: PromptHint;
	private editor: Editor;
	private statusBar: StatusBar;
	private container: Container;
	private agent: Agent;
	private inFlight = false;
	private spinnerFrameIndex = 0;
	private spinnerTimer: Timer | null = null;
	private helpOverlay: OverlayHandle | null = null;
	onExit?: () => void;

	constructor(agent: Agent, options: TuiOptions) {
		this.agent = agent;

		const terminal = new ProcessTerminal();
		this.tui = new TUI(terminal, true);

		this.header = new Header(options);
		this.conversationArea = new ConversationArea();
		this.promptHint = new PromptHint();
		this.editor = new Editor(this.tui, DEFAULT_EDITOR_THEME, { paddingX: 1 });
		this.statusBar = new StatusBar();

		this.container = new Container();
		this.container.addChild(this.header);
		this.container.addChild(this.conversationArea);
		this.container.addChild(this.promptHint);
		this.container.addChild(this.editor);
		this.container.addChild(this.statusBar);

		this.tui.addChild(this.container);
		this.tui.setFocus(this.editor);

		this.loadHistory(agent.getMessages());
		this.statusBar.setStatus({
			mode: "ready",
			text:
				this.conversationArea.count() > 0
					? `${this.conversationArea.count()} messages loaded`
					: "Ready",
		});

		this.editor.onSubmit = (text: string) => {
			void this.handleSubmit(text);
		};

		this.tui.addInputListener((data: string) => {
			if (matchesKey(data, "esc") && this.tui.hasOverlay()) {
				this.tui.hideOverlay();
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+g")) {
				this.toggleHelp();
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+l")) {
				this.conversationArea.clear();
				this.statusBar.setStatus({ mode: "info", text: "Conversation cleared" });
				this.tui.requestRender();
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+c")) {
				if (this.inFlight) {
					this.agent.abort();
					this.statusBar.setStatus({ mode: "busy", text: "Cancelling request..." });
					this.tui.requestRender();
					return { consume: true };
				}
				this.onExit?.();
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+d") && this.editor.getText().trim() === "" && !this.inFlight) {
				this.onExit?.();
				return { consume: true };
			}
			return undefined;
		});
	}

	private async handleSubmit(text: string): Promise<void> {
		if (!text.trim()) {
			return;
		}
		if (this.inFlight) {
			this.statusBar.setStatus({ mode: "busy", text: "Previous request still running" });
			this.tui.requestRender();
			return;
		}

		this.conversationArea.addMessage({ role: "user", content: text });
		this.editor.setText("");
		this.inFlight = true;
		this.editor.disableSubmit = true;
		this.header.setInFlight(true);
		this.promptHint.setDisabled(true);
		this.startSpinner();
		this.statusBar.setStatus({ mode: "busy", text: "Thinking..." });
		this.tui.requestRender();

		try {
			const response: AgentResponse = await this.agent.prompt(text);
			this.conversationArea.addMessage({
				role: "assistant",
				content: response.content,
				toolCalls: response.toolCalls?.map((tc) => ({
					name: tc.name,
					args: tc.args,
				})),
			});
			this.statusBar.setStatus({ mode: "ready", text: "Ready" });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.conversationArea.addMessage({
				role: "assistant",
				content: `Error: ${errorMessage}`,
			});
			this.statusBar.setStatus({ mode: "error", text: errorMessage });
		} finally {
			this.stopSpinner();
			this.inFlight = false;
			this.editor.disableSubmit = false;
			this.header.setInFlight(false);
			this.promptHint.setDisabled(false);
			this.tui.requestRender();
		}
	}

	private startSpinner(): void {
		this.spinnerFrameIndex = 0;
		this.statusBar.setSpinner(SPINNER_FRAMES[this.spinnerFrameIndex] ?? "");
		this.spinnerTimer = setInterval(() => {
			this.spinnerFrameIndex = (this.spinnerFrameIndex + 1) % SPINNER_FRAMES.length;
			this.statusBar.setSpinner(SPINNER_FRAMES[this.spinnerFrameIndex] ?? "");
			this.tui.requestRender();
		}, 80);
	}

	private stopSpinner(): void {
		if (this.spinnerTimer) {
			clearInterval(this.spinnerTimer);
			this.spinnerTimer = null;
		}
		this.statusBar.setSpinner("");
	}

	private toggleHelp(): void {
		if (!this.helpOverlay) {
			this.helpOverlay = this.tui.showOverlay(new HelpOverlay(), {
				anchor: "center",
				width: "76%",
				minWidth: 40,
				maxHeight: "80%",
				margin: 1,
			});
			this.statusBar.setStatus({ mode: "info", text: "Help opened" });
			this.tui.requestRender();
			return;
		}
		if (this.helpOverlay.isHidden()) {
			this.helpOverlay.setHidden(false);
			this.statusBar.setStatus({ mode: "info", text: "Help opened" });
		} else {
			this.helpOverlay.setHidden(true);
			this.statusBar.setStatus({ mode: "info", text: "Help closed" });
		}
		this.tui.requestRender();
	}

	private loadHistory(messages: ModelMessage[]): void {
		for (const message of messages) {
			if (message.role !== "user" && message.role !== "assistant") {
				continue;
			}
			const content = modelMessageToText(message);
			if (!content) {
				continue;
			}
			this.conversationArea.addMessage({
				role: message.role,
				content,
			});
		}
	}

	start(): void {
		this.tui.start();
		this.tui.requestRender();
	}

	stop(): void {
		this.stopSpinner();
		this.tui.stop();
	}

	addMessage(message: MessageItem): void {
		this.conversationArea.addMessage(message);
		this.tui.requestRender();
	}
}

function joinSides(left: string, right: string, width: number): string {
	const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
	const line = `${left}${" ".repeat(gap)}${right}`;
	return truncateToWidth(line, width);
}

function formatToolCall(name: string, args: Record<string, unknown>): string {
	const parts = Object.entries(args)
		.slice(0, 2)
		.map(([k, v]) => `${k}=${formatArgValue(v)}`);
	const suffix = Object.keys(args).length > 2 ? ", ..." : "";
	return `${name}(${parts.join(", ")}${suffix})`;
}

function formatArgValue(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "string") {
		const oneLine = value.replace(/\s+/g, " ");
		return JSON.stringify(oneLine.length > 24 ? `${oneLine.slice(0, 21)}...` : oneLine);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.length}]`;
	}
	if (typeof value === "object") {
		return "{...}";
	}
	return JSON.stringify(value);
}

function modelMessageToText(message: ModelMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	const chunks: string[] = [];
	for (const part of message.content) {
		if (part && typeof part === "object" && "type" in part && part.type === "text") {
			const text = "text" in part ? part.text : "";
			if (typeof text === "string" && text.length > 0) {
				chunks.push(text);
			}
		}
	}
	return chunks.join("\n");
}

export function createTui(agent: Agent, options: TuiOptions): ZiTui {
	return new ZiTui(agent, options);
}
