import type {
	ComputerCapability,
	ShellCapability,
	WebCapability,
} from "#core/core/types/capability.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zAttachmentPart } from "#core/features/data/types/part.ts";
import { TranscriptUtils } from "#core/features/data/utils/TranscriptUtils.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import { ComputerService } from "#core/features/tool/services/ComputerService.ts";

export const AttachmentService = {
	unavailable: ({
		source,
		label = PathUtils.name(source),
	}: {
		source: string;
		label?: string;
	}): zAttachmentPart => ({
		id: CommonUtils.getRandomId(),
		type: "attachment",
		source,
		label,
		content: { type: "unavailable" },
	}),

	build: async ({
		source,
		label = PathUtils.name(source),
		directory = false,
		shell,
		web,
		chat,
		browser,
		computer,
	}: {
		source: string;
		label?: string;
		directory?: boolean;
		shell?: Pick<ShellCapability, "readFile" | "readDir">;
		web?: Pick<WebCapability, "view">;
		/** Reads another of the user's chats, for a `chat:<id>` source. */
		chat?: (id: string) => Promise<{
			title: string | null;
			messages: Pick<MessageState, "author" | "createdAt" | "data">[];
		}>;
		/** Reads a tab of the agent's browser, for a `browser:<index>` source. */
		browser?: (
			tab: number,
		) => Promise<{ url: string; title?: string; text: string }>;
		/** The host's computer, for a `window:<id>` source. */
		computer?: ComputerCapability;
	}): Promise<zAttachmentPart> => {
		const id = CommonUtils.getRandomId();
		let content: zAttachmentPart["content"];

		if (source.startsWith("browser:")) {
			if (!browser) throw new Error(`Cannot read browser tab: ${source}`);
			const tab = Number(source.slice(8));
			const result = await browser(tab);
			content = {
				type: "browser",
				tab,
				url: result.url,
				title: result.title || undefined,
				text: result.text,
			};
		} else if (source.startsWith("window:")) {
			if (!computer) throw new Error(`Cannot read window: ${source}`);
			const status = await ComputerService.status(computer);
			if (!status.available) {
				throw new Error(status.error ?? `Cannot read window: ${source}`);
			}
			// The outline is the attachment; a screenshot only adds to it. Where
			// the screen cannot be captured at all it is not tried, which would
			// raise the window for nothing, and one that fails is left out.
			const result = await ComputerService.run({
				capability: computer,
				window: source.slice(7),
				steps: [{ action: "read" }],
				screenshot: status.screen !== false,
			});
			const failed = result.steps.find(
				(step) => !step.ok && step.action !== "screenshot",
			);
			if (failed || !result.window) {
				throw new Error(failed?.error ?? `No window ${source.slice(7)}`);
			}
			const outline = result.steps.find((step) => step.action === "read");
			content = {
				type: "window",
				window: result.window.id,
				app: result.window.app,
				title: result.window.title,
				outline: typeof outline?.value === "string" ? outline.value : "",
				screenshot: result.screenshots.at(-1),
			};
		} else if (source.startsWith("web:")) {
			if (!web) throw new Error(`Cannot read web attachment: ${source}`);
			const result = await web.view({ url: source.slice(4) });
			content = {
				type: "web",
				title: result.title,
				content: result.content,
			};
		} else if (source.startsWith("chat:")) {
			if (!chat) throw new Error(`Cannot read chat attachment: ${source}`);
			const { title, messages } = await chat(source.slice(5));
			content = {
				type: "chat",
				title,
				transcript: TranscriptUtils.build({ title, messages }),
			};
		} else if (directory) {
			if (!shell)
				throw new Error(`Cannot read attachment directory: ${source}`);
			const entries = await FileOperationService.walk({
				shell,
				path: source,
				scope: "lookup",
				includeDirectories: true,
			});
			content = {
				type: "directory",
				items: entries.map((entry) => ({
					path: entry.path,
					directory: entry.is_dir || undefined,
				})),
			};
		} else {
			if (!shell) throw new Error(`Cannot read attachment file: ${source}`);
			const file = await shell.readFile({ path: source });
			content = {
				type: "file",
				mime: await FileTypeUtils.getMime(file),
				data: FileUtils.getBase64FromBytes(file),
			};
		}

		return { id, type: "attachment", source, label, content };
	},
} as const;
