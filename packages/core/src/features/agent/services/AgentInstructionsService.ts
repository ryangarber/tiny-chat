import type { Capabilities } from "#core/core/types/capability.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { zAgentContext } from "#core/features/agent/types/agent.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import type { zSkill } from "#core/features/skill/types/skill.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";
import { ToolUtils } from "#core/features/tool/utils/ToolUtils.ts";

export const AgentInstructionsService = {
	buildInstructions: async ({
		context,
		config,
		enabledToolsets,
		enabledSkills,
		capabilities,
	}: {
		context: zAgentContext;
		config?: zConfig | null;
		capabilities: Capabilities;
		enabledToolsets: Toolset<any>[];
		enabledSkills: zSkill[];
	}) => {
		const settings = SettingsUtils.of(context.user, context.chat?.project);

		const actions = !context.chat?.incognito
			? await capabilities.actions?.getActions()
			: undefined;

		const cites = new Map<string, string>();
		if (enabledToolsets.some((toolset) => toolset.name === "actions")) {
			cites.set(
				"actions",
				`I'll <cite sources="xyzxyz">check for updates on the Mets game</cite> tomorrow.`,
			);
		}
		if (enabledToolsets.some((toolset) => toolset.name === "memories")) {
			cites.set(
				"memories",
				`Here's an example in <cite sources="123456 abcdef">Python, your favorite language</cite>.`,
			);
		}
		if (enabledToolsets.some((toolset) => toolset.name === "shell")) {
			cites.set(
				"files",
				`I'll now edit <cite sources="/home/user/desktop/todo.txt">your to-do list</cite> to mark off this task.`,
			);
		}
		if (enabledToolsets.some((toolset) => toolset.name === "web")) {
			cites.set(
				"web results",
				`As of yesterday, <cite sources="https://example.com/123456 https://msn.com/xyz">the DOW has fallen 5 points</cite>.`,
			);
		}
		const citeTypes = Array.from(cites.keys());
		const citeTypeList = citeTypes.length
			? citeTypes.slice(0, -1).join(", ") +
				(citeTypes.length > 1 ? ", or " : "") +
				citeTypes.at(-1)
			: undefined;
		const citeExamples = Array.from(cites.values());

		let instructions = `Formatting re-enabled.`;

		if (config?.model) {
			instructions += `\n
## Identity\n
You are ${config.model}. Each user <message> names the model it was sent to in its \`to\` attribute, and the assistant reply that follows it was written by that model. Different models may have answered over the course of this chat, each with its own knowledge and capabilities: only replies to messages sent to ${config.model} were written by you, and the latest message was sent to you.
When referring to a reply written by another model, call it by that model's name - never "I". Critique other models' replies from your own perspective when appropriate.`;
		}

		instructions += `\n
## Instructions\n
The times mentioned in <message> blocks are the user's local time. Never convert to UTC when calling tools, always use the user's time.
Always take those times into account. Do not assume the chat is continuous. Consider whether the user's intent has changed between messages.`;

		if (enabledToolsets.length) {
			instructions += `\n
Tool calls you make together run at the same time. When calls do not depend on each other's results, make them together rather than one after another.`;
		}

		instructions += `\n
Markdown, Mermaid, and LaTeX are supported. Use headers, tables, lists, math, code blocks, diagrams, and images when they would genuinely help illustrate your point.
Important: Always use two dollar signs ($$...$$) for both inline and display math - never one ($...$). Use one dollar sign in non-math cases such as currency ($5.00).`;

		if (citeTypeList) {
			instructions += `\n
When a statement is based on or references ${citeTypeList}, always wrap the statement in a <cite> tag with their IDs or URLs separated by spaces.
The <cite> tag is metadata only - it wraps the original statement(s), never provides its own text. The conversation should maintain its original flow:
${citeExamples.map((r) => `- ${r}`).join("\n")}`;
		}

		const cwd =
			enabledToolsets.some((toolset) => toolset.name === "shell") &&
			!!capabilities.shell?.cwd;

		if (
			actions?.length ||
			enabledToolsets.length ||
			enabledSkills.length ||
			cwd
		) {
			instructions += `\n
## Context`;

			if (context.chat?.id) {
				instructions += `\n
	<chat>/mnt/chat/${context.chat.id}/</chat>`;
			}

			if (context.chat?.project?.title) {
				instructions += `\n
<project title="${context.chat.project.title}" />`;
			}

			const shell = capabilities.shell;
			// Only folders that exist here: the rest belong to other devices.
			const resolved =
				settings.folders.length &&
				enabledToolsets.some((toolset) => toolset.name === "shell")
					? ((await shell?.folders?.().catch(() => null)) ?? [])
					: [];

			if (resolved.length) {
				const primary = resolved[0];
				const folders = settings.folders
					.filter(
						(folder, index, all) =>
							resolved.includes(folder.path) &&
							all.findIndex((other) => other.path === folder.path) === index,
					)
					.map((folder) => ({
						...folder,
						project: context.chat?.project?.settings?.folders?.find(
							(other) => other.path === folder.path,
						),
						// As the shell spells it, which is how the model will see it.
						local: shell?.toShellPath?.({ path: folder.path }) ?? folder.path,
					}));

				instructions += `\n
The user works in these folders. A primary project folder is where the shell starts.
<folders>
${folders.map((folder) => `<folder scope="${folder.project ? "project" : "user"}"${folder.path === primary ? " primary" : ""}>${folder.local}</folder>`).join("\n")}
</folders>`;
			}

			if (actions?.length) {
				instructions += `\n
<actions>
${actions?.map((action) => `<action id="${action.id}" schedule="${action.schedule}">\n${DataUtils.getText(action)}\n</action>`).join("\n")}
</actions>`;
			}

			// A toolset with nothing to say — the plan's, whose instructions go
			// with the message that asked for it — leaves the prompt as it was.
			const instructed = enabledToolsets.filter(
				(toolset) => toolset.instructions,
			);
			if (instructed.length) {
				instructions += `\n
<toolsets>
${instructed.map((toolset) => `<toolset name="${ToolUtils.name({ toolset })}">\n${toolset.instructions}\n</toolset>`).join("\n")}
</toolsets>`;
			}

			if (enabledSkills.length) {
				instructions += `\n
<skills>
${enabledSkills.map((skill) => `<skill name="${skill.name}" path="${skill.path}">\n${skill.description}\n</skill>`).join("\n")}
</skills>`;

				if (enabledToolsets.some((toolset) => toolset.name === "shell")) {
					instructions += `\n
As an assistant, you may have access to additional skills. When one seems relevant, use your tools to read its \`SKILL.md\` file and follow instructions from there.`;
				}
			}
		}

		if (settings.instructions?.length) {
			instructions += `\n
## Additional Instructions\n
${settings.instructions.join("\n")}`;
		}

		return instructions;
	},
} as const;
