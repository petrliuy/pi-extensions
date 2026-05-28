import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const TOOLING_CONTEXT_MARKER = "[TOOLING POLICY]";

function hasToolingContext(message: AgentMessage & { customType?: string }): boolean {
	if (message.customType === "tooling-context") return true;
	if (message.role !== "user") return false;

	const content = message.content;
	if (typeof content === "string") {
		return content.includes(TOOLING_CONTEXT_MARKER);
	}
	if (Array.isArray(content)) {
		return content.some((block) => {
			const text = block.type === "text" ? (block as TextContent).text : undefined;
			return text?.includes(TOOLING_CONTEXT_MARKER) ?? false;
		});
	}
	return false;
}

export default function toolingExtension(pi: ExtensionAPI): void {
	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((message) => !hasToolingContext(message as AgentMessage & { customType?: string })),
		};
	});

	pi.on("before_agent_start", async () => {
		return {
			message: {
				customType: "tooling-context",
				content: `${TOOLING_CONTEXT_MARKER}
Tool selection preferences for every turn:
- Prefer rg for text search. Prefer rg --files or fd for file discovery instead of broad find or grep.
- Prefer jq for inspecting, filtering, and transforming JSON in shell pipelines.
- Prefer yq for inspecting, filtering, and transforming YAML, TOML, XML, and properties-style structured config.
- Prefer http/httpie for readable API calls and JSON responses. Use curl when lower-level flags or compatibility are needed.
- Inspect existing repo tooling before adding commands. Use package scripts, local binaries, or documented project workflows when they exist.
- For library, framework, SDK, API, CLI, or cloud-service documentation questions, use Context7 with npx ctx7@latest library first, then npx ctx7@latest docs for the selected library id.
- For one-off external tools, prefer ephemeral execution such as uvx, npx, bunx, go run, or cargo before proposing installation.
- Avoid global installs, curl | sh, and persistent environment mutation unless explicitly approved by the user.
- Pin ephemeral tool versions when reproducibility or compatibility matters.
- Explain why an external tool is needed and show the exact command when it is not already obvious from the task.`,
				display: false,
			},
		};
	});
}
