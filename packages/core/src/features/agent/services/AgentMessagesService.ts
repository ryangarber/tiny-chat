import type {
	Capabilities,
	ShellCapability,
} from "#core/core/types/capability.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type {
	zAgentContext,
	zAgentMessage,
} from "#core/features/agent/types/agent.ts";
import type { MemorySearchResult } from "#core/features/data/types/memory.ts";
import type {
	zAttachmentPart,
	zDataPart,
} from "#core/features/data/types/part.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import { EditorPartUtils } from "#core/features/data/utils/EditorPartUtils.ts";
import { FileOperationService } from "#core/features/file/services/FileOperationService.ts";
import { FileTypeUtils } from "#core/features/file/utils/FileTypeUtils.ts";
import {
	type Descendent,
	FileUtils,
} from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import { VERBOSE } from "#core/logger.ts";

/** Directory levels shown in an attached folder's XML tree. */
const MAX_ATTACHMENT_TREE_DEPTH = 2;

export const AgentMessagesService = {
	buildMessages: async ({
		context,
		capabilities,
	}: {
		context: zAgentContext;
		capabilities: Capabilities;
	}): Promise<{ messages: zAgentMessage[]; customInstructions?: string }> => {
		const messages: zAgentMessage[] = [];

		const memoryBudget = SettingsUtils.of(
			context.user,
			context.chat?.project,
		)?.memoryBudget;
		console.log("[AgentMessagesService] memory budget:", memoryBudget);
		const memories = !context.chat?.incognito
			? await capabilities.memories?.retrieveMemories({
					messages: context.messages.map((message) =>
						message.id
							? { id: message.id }
							: { text: DataUtils.getTextCleaned(message) },
					),
					tokens: memoryBudget,
				})
			: undefined;

		let customInstructions: string | undefined;

		for (let i = 0; i < context.messages.length; i++) {
			const message = context.messages[i];
			const previous = context.messages[i - 1];

			// Each step is transformed on its own: tool results are only ever
			// sorted within the step that called them.
			const data: zDataPart[][] = [];
			for (const parts of message.data) {
				const transformedParts: zDataPart[] = [];
				for (const part of parts) {
					if (part.type === "attachment") {
						transformedParts.push(
							...AgentMessagesService.buildAttachmentParts(part),
						);
					} else if (part.type === "quote") {
						const model = part.model ? ` model="${part.model}"` : "";
						transformedParts.push({
							id: part.id,
							type: "text",
							value: `<quote${model}>\n${part.text}\n</quote>`,
						});
					} else if (part.type === "paste") {
						transformedParts.push({
							id: part.id,
							type: "text",
							value: EditorPartUtils.fence(part.text, part.language),
						});
					} else if (part.type === "command") {
						// A skill is written as a command but read as its SKILL.md, which
						// is the only thing about it the model ever sees.
						if (part.value?.startsWith("skill:")) {
							transformedParts.push(
								...(await AgentMessagesService.buildSourceParts({
									capabilities,
									id: part.id,
									source: part.value.slice(6),
								})),
							);
						} else if (part.name === "system-prompt") {
							customInstructions = part.argument;
							console.log(
								"[AgentMessagesService] using custom instructions:",
								part.argument,
							);
						} else {
							console.warn(
								"[AgentMessagesService] ignoring unknown command:",
								part.name,
							);
							transformedParts.push({
								id: part.id,
								type: "text",
								value: EditorPartUtils.toText(part),
							});
						}
					} else {
						transformedParts.push(part);
					}
				}
				data.push(transformedParts);
			}

			messages.push(
				AgentMessagesService.buildMessageBlock({
					message,
					previous,
					data,
					timezone: context.timezone,
					memories: memories?.at(i),
				}),
			);
		}

		if (VERBOSE)
			console.log("[AgentMessagesService] built messages:", messages);

		return { messages, customInstructions };
	},

	/**
	 * A path on the host, read now and wrapped the way a stored attachment is.
	 *
	 * Used for the things a message references rather than captures — a skill,
	 * which is named by the command that enabled it and read as its `SKILL.md`.
	 */
	buildSourceParts: async ({
		capabilities,
		id,
		source,
		name,
		directory,
	}: {
		capabilities: Capabilities;
		id: string;
		source: string;
		name?: string;
		directory?: boolean;
	}): Promise<zDataPart[]> => {
		let content: zDataPart | undefined;

		try {
			const shell = PathUtils.isMounted(source)
				? capabilities.chatShell
				: capabilities.shell;

			if (source.startsWith("web:")) {
				const web = await capabilities.web?.view({ url: source.slice(4) });
				if (web) content = { id, type: "text", value: web.content };
			} else if (directory) {
				const xml = await AgentMessagesService.buildDirectoryBlock({
					shell,
					path: source,
				});
				if (xml) content = { id, type: "text", value: xml };
			} else {
				const file = await shell?.readFile({ path: source });
				if (file) {
					content = {
						id: CommonUtils.getRandomId(),
						type: "file",
						name: PathUtils.name(file),
						data: FileUtils.getBase64FromBytes(file),
						mime:
							(await FileTypeUtils.getMime(file)) ?? "application/octet-stream",
					};
				}
			}
		} catch (error: any) {
			console.error("[AgentMessagesService] error reading attachment:", error);
		}

		// An upload is mounted under its id, which says nothing about what it
		// holds, so the name it was attached under stands in for the path.
		const label = name ? ` name="${name}"` : "";

		return [
			{
				id: CommonUtils.getRandomId(),
				type: "text",
				value: `<attachment source="${PathUtils.normalize({ path: source })}"${label}>`,
			},
			content ?? { id, type: "text", value: "<!-- content unavailable -->" },
			{
				id: CommonUtils.getRandomId(),
				type: "text",
				value: "</attachment>",
			},
		];
	},

	buildAttachmentParts: (attachment: zAttachmentPart): zDataPart[] => {
		const source = PathUtils.normalize({ path: attachment.source });
		let content: zDataPart;

		if (attachment.content.type === "file") {
			content = {
				id: attachment.id,
				type: "file",
				name: PathUtils.name(attachment.source),
				mime: attachment.content.mime ?? "application/octet-stream",
				data: attachment.content.data,
			};
		} else if (attachment.content.type === "web") {
			content = {
				id: attachment.id,
				type: "text",
				value: attachment.content.content,
			};
		} else if (attachment.content.type === "chat") {
			content = {
				id: attachment.id,
				type: "text",
				value: attachment.content.transcript,
			};
		} else if (attachment.content.type === "directory") {
			content = {
				id: attachment.id,
				type: "text",
				value: AgentMessagesService.buildDirectoryItems({
					path: attachment.source,
					items: attachment.content.items,
				}),
			};
		} else {
			content = {
				id: attachment.id,
				type: "text",
				value: "<!-- content unavailable -->",
			};
		}

		return [
			{
				id: CommonUtils.getRandomId(),
				type: "text",
				value: `<attachment source="${source}" name="${attachment.label}">`,
			},
			content,
			{
				id: CommonUtils.getRandomId(),
				type: "text",
				value: "</attachment>",
			},
		];
	},

	buildDirectoryItems: ({
		path,
		items,
	}: {
		path: string;
		items: { path: string; directory?: boolean }[];
	}) => {
		const base = PathUtils.normalize({ path, unix: true }).replace(/\/+$/, "");
		const nodes = items.map((item) => {
			const normalized = PathUtils.normalize({ path: item.path, unix: true });
			return {
				uri: item.path,
				is_dir: item.directory ?? false,
				path: PathUtils.split(PathUtils.relative({ base, path: normalized })),
			};
		});
		return AgentMessagesService.buildTree({
			tree: FileUtils.toTree({ nodes }),
			depth: 0,
		});
	},

	/**
	 * Frames a message for the model.
	 *
	 * Only the user's messages are wrapped in a `<message>` block, which says
	 * when they were sent and to which model — so the reply that follows is
	 * known to be that model's. A reply goes out exactly as the model wrote it,
	 * step by step: it is sent that way while it is being generated, and
	 * framing it any differently once it is done would change a part of the
	 * chat the model has already read, and with it every cached request after.
	 */
	buildMessageBlock: ({
		message,
		previous,
		data,
		timezone,
		memories,
	}: {
		message: zAgentMessage;
		previous?: zAgentMessage;
		data: zDataPart[][];
		timezone?: string;
		memories?: MemorySearchResult[];
	}): zAgentMessage => {
		const context: zDataPart[] = memories?.length
			? [
					{
						id: CommonUtils.getRandomId(),
						type: "text",
						value: `<context>\n${[...memories]
							.sort((a, b) => a.id.localeCompare(b.id))
							.map(
								(memory) =>
									`<memory id="${memory.id}" category="${memory.category}" stability="${memory.stability}" learned="${CommonUtils.formatDate({ date: memory.createdAt, timezone })}">\n${memory.fact}\n</memory>`,
							)
							.join("\n")}\n</context>`,
					},
				]
			: [];

		if (message.author === "MODEL") {
			const [first = [], ...rest] = data;
			return {
				...message,
				data: context.length ? [[...context, ...first], ...rest] : data,
			};
		}

		const attributes: Record<string, string> = { role: "user" };

		const model = message.config?.model;
		if (model) attributes.to = model;

		if (message.createdAt) {
			attributes.sent = CommonUtils.formatDate({
				date: message.createdAt,
				timezone,
			});
			if (previous?.createdAt) {
				attributes.gap = CommonUtils.formatTimespan({
					from: previous.createdAt,
					to: message.createdAt,
				});
			}
		}

		const opening: zDataPart = {
			id: CommonUtils.getRandomId(),
			type: "text",
			value: `<message${Object.entries(attributes)
				.map(([k, v]) => ` ${k}="${v}"`)
				.join("")}>`,
		};
		const closing: zDataPart = {
			id: CommonUtils.getRandomId(),
			type: "text",
			value: "</message>",
		};

		return {
			...message,
			data: [[...context, opening, ...data.flat(), closing]],
		};
	},

	buildDirectoryBlock: async ({
		shell,
		path,
	}: {
		shell?: Pick<ShellCapability, "readDir">;
		path: string;
	}) => {
		if (!shell) return null;
		const base = PathUtils.normalize({ path, unix: true }).replace(/\/+$/, "");
		// The tree of an attached directory is the user showing what they sent.
		// Screening it the way a text search does would drop the screenshots and
		// logs that were often the entire reason for attaching it.
		const entries = await FileOperationService.walk({
			shell,
			path,
			scope: "listing",
			includeDirectories: true,
		});

		const nodes = entries.map((entry) => {
			const normalized = PathUtils.normalize({ path: entry.path, unix: true });
			const relative = normalized.replace(
				new RegExp(`^${CommonUtils.escapeRegex(base)}\\/?`),
				"",
			);
			return {
				uri: entry.path,
				is_dir: entry.is_dir,
				path: PathUtils.split(relative),
			};
		});

		const tree = FileUtils.toTree({ nodes });
		return AgentMessagesService.buildTree({ tree, depth: 0 });
	},

	buildTree: <T extends { uri?: string; is_dir?: boolean }>({
		tree,
		depth = 0,
		maxDepth = MAX_ATTACHMENT_TREE_DEPTH,
	}: {
		tree: Descendent<T>;
		depth?: number;
		maxDepth?: number;
	}): string => {
		if (maxDepth <= 0) return "";
		const nodes: string[] = [];
		for (const [segment, child] of tree.children) {
			const isDirectory = child.node
				? ((child.node as T).is_dir ?? false)
				: true;
			nodes.push(
				AgentMessagesService.buildNode({
					name: segment,
					uri: child.node && !isDirectory ? (child.node as T).uri : undefined,
					directory: isDirectory,
					content: isDirectory
						? AgentMessagesService.buildTree({
								tree: child,
								depth: depth + 1,
								maxDepth: maxDepth - 1,
							})
						: undefined,
					depth,
				}),
			);
		}
		return nodes.join("\n");
	},

	buildNode: ({
		name,
		uri,
		directory,
		content,
		depth = 0,
	}: {
		name: string;
		uri?: string;
		directory?: boolean;
		content?: string;
		depth?: number;
	}) => {
		const type = directory ? "folder" : "file";
		return `${"  ".repeat(depth)}<${type} name="${name}"${uri ? ` path="${uri}"` : ""}${content ? `>\n${content}\n${"  ".repeat(depth)}</${type}>` : ` />`}`;
	},
};
