const revealEls = document.querySelectorAll(".reveal");

for (const el of revealEls) {
	const delay = Number(el.getAttribute("data-delay") || "0");
	el.style.setProperty("--delay", `${delay}ms`);
}

const observer = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				entry.target.classList.add("is-visible");
			}
		}
	},
	{ threshold: 0.18 }
);

for (const el of revealEls) {
	observer.observe(el);
}

const terminalOutput = document.getElementById("terminal-output");
const timelineList = document.getElementById("timeline-list");
const replayBtn = document.getElementById("replay-btn");

const steps = [
	{
		log: "$ xi --provider openai --session sf-startup-demo",
		timelineTitle: "Session boot",
		timelineDetail: "Created `.xi/sessions/sf-startup-demo.db` in 48ms",
	},
	{
		log: 'tool.read { path: "src/tools/edit.ts" }',
		timelineTitle: "Read tool",
		timelineDetail: "Bash sandbox read completed, 1,923 bytes",
	},
	{
		log: 'tool.edit { path: "src/tools/edit.ts", old: "replace", new: "replaceAll" }',
		timelineTitle: "Edit tool",
		timelineDetail: "Patch generated in-memory, awaiting write",
	},
	{
		log: 'tool.write { path: "src/tools/edit.ts" }',
		timelineTitle: "Write tool",
		timelineDetail: "AgentFS write committed, hash=6f2cd9...",
	},
	{
		log: 'tool.bash { command: "bun test test/edit.test.ts" }',
		timelineTitle: "Validation",
		timelineDetail: "1 test file passed, output + timing logged",
	},
	{
		log: "commit: success · 5 tool calls · full trace in sqlite",
		timelineTitle: "Audit trail",
		timelineDetail: "Replayable timeline stored with params, output, and errors",
	},
];

let activeTimer = 0;

const resetDemo = () => {
	clearTimeout(activeTimer);
	terminalOutput.textContent = "";
	timelineList.innerHTML = "";
};

const appendLog = (value) => {
	terminalOutput.textContent += `${value}\n`;
	terminalOutput.scrollTop = terminalOutput.scrollHeight;
};

const appendTimeline = (title, detail, index) => {
	const item = document.createElement("li");
	item.style.animationDelay = `${index * 90}ms`;
	item.innerHTML = `<strong>${title}</strong>${detail}`;
	timelineList.append(item);
};

const playDemo = (index = 0) => {
	if (index >= steps.length) {
		appendLog("$ query sqlite: select * from tool_calls order by started_at desc limit 3;");
		appendLog("→ trace ready for audit");
		return;
	}

	const step = steps[index];
	appendLog(step.log);
	appendTimeline(step.timelineTitle, step.timelineDetail, index);
	activeTimer = window.setTimeout(() => playDemo(index + 1), 650);
};

replayBtn?.addEventListener("click", () => {
	resetDemo();
	playDemo();
});

playDemo();
