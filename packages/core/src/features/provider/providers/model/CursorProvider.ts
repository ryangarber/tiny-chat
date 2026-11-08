import {
	type CursorHost,
	type CursorModelInfo,
	type CursorOptions,
	type CursorProvider as CursorSdk,
	type CursorSubagentProgress,
	createCursor,
} from "@ryangarber/ai-sdk-providers/cursor";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import type {
	zData,
	zDataSimplePart,
	zSignature,
} from "#core/features/data/types/part.ts";
import type {
	ModelProvider,
	zModelArg,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";

const NAME = "cursor";
const MODES = ["off", "sandbox", "full-access"] as const;
const SUPPORTED_FILES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const metadataOf = (event: unknown) =>
	(event as { providerMetadata?: Record<string, Record<string, unknown>> })
		?.providerMetadata?.[NAME];

const signatureOf = (event: unknown): zSignature | undefined => {
	const metadata = metadataOf(event);
	if (typeof metadata?.agentId !== "string") return undefined;
	return {
		model: NAME,
		item: metadata.agentId,
		metadata: Object.fromEntries(
			Object.entries(metadata).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
	};
};

const toFile = (data: string, mime: string): zDataSimplePart => ({
	id: CommonUtils.getRandomId(),
	type: "file",
	mime,
	data: data.replace(/^data:[^,]*,/, ""),
});

const toParts = (output: unknown): zDataSimplePart[] => {
	if (output === undefined || output === null) return [];
	if (typeof output === "object") {
		const value = output as Record<string, any>;
		if (value.status === "success") return toParts(value.value);
		if (value.status === "error")
			return toParts(
				typeof value.error?.message === "string"
					? value.error.message
					: value.error,
			);
		if (Array.isArray(output)) return output.flatMap(toParts);
		if (Array.isArray(value.content)) return value.content.flatMap(toParts);
		if (value.type === "image" && typeof value.data === "string")
			return [
				toFile(
					value.data,
					typeof value.mimeType === "string" ? value.mimeType : "image/png",
				),
			];
		// An MCP server's content, as Cursor reports it.
		if (typeof value.image?.data === "string")
			return [toFile(value.image.data, value.image.mimeType ?? "image/png")];
		if (typeof value.text?.text === "string") return toParts(value.text.text);
		if (typeof value.text === "string") return toParts(value.text);
		if (typeof value.output === "string") return toParts(value.output);
	}
	return [
		{
			id: CommonUtils.getRandomId(),
			type: "text",
			value: typeof output === "string" ? output : JSON.stringify(output),
		},
	];
};

const toJson = (value: unknown): zDataSimplePart => ({
	id: CommonUtils.getRandomId(),
	type: "json",
	value,
});

const toText = (value: string): zDataSimplePart[] =>
	value ? toParts(value) : [];

/** Entries of a listing shown before the rest is only counted. */
const MAX_ENTRIES = 500;

/** A directory tree as `read_files` lists one: directories, then files, deep. */
const toEntries = (node: any): { path: string; is_dir: boolean }[] => {
	const root = String(node?.absPath ?? "").replace(/[\\/]+$/, "");
	return [
		...(Array.isArray(node?.childrenDirs) ? node.childrenDirs : []).flatMap(
			(child: any) => [
				{ path: String(child?.absPath ?? ""), is_dir: true },
				...toEntries(child),
			],
		),
		...(Array.isArray(node?.childrenFiles) ? node.childrenFiles : []).map(
			(file: any) => ({ path: `${root}/${file?.name ?? ""}`, is_dir: false }),
		),
	];
};

/** One workspace's grep results, as `search_files` reports its matches. */
const toGrep = (result: any): zDataSimplePart[] => {
	const output = result?.output ?? {};
	if (result?.type === "files")
		return (output.files ?? []).map((path: string) => toJson(path));
	if (result?.type === "count")
		return toText(
			(output.counts ?? [])
				.map((count: any) => `${count.file}: ${count.count}`)
				.join("\n"),
		);
	// `12:match` and `11-context`, as ripgrep prints them.
	const files = new Map<string, string[]>();
	for (const match of output.matches ?? []) {
		const lines = files.get(match.file) ?? [];
		const at = match.lineNumber as number | undefined;
		const before: string[] = match.beforeContext ?? [];
		const after: string[] = match.afterContext ?? [];
		const line = (offset: number, text: string, mark: string) =>
			at === undefined ? text : `${at + offset}${mark}${text}`;
		lines.push(
			...before.map((text, index) => line(index - before.length, text, "-")),
			line(0, match.line, ":"),
			...after.map((text, index) => line(index + 1, text, "-")),
		);
		files.set(match.file, lines);
	}
	return [...files].map(([path, lines]) =>
		toJson({ path, snippet: lines.join("\n") }),
	);
};

/**
 * What one of Cursor's own tools returned, as the matching Tiny Chat tool
 * would put it: a command's output, a file's text, paths and matches.
 */
const toOutput = (name: string, output: unknown): zDataSimplePart[] => {
	const result = output as { status?: string; value?: any } | undefined;
	if (result?.status !== "success") return toParts(output);
	const value = result.value ?? {};
	switch (name) {
		case "shell":
			return [
				toJson({
					stdout: String(value.stdout ?? ""),
					stderr: String(value.stderr ?? ""),
					code: Number(value.exitCode ?? 0),
				}),
			];
		case "read":
			return [toJson({ content: String(value.content ?? "") })];
		case "glob":
			return [
				...(value.files ?? []).map((path: string) => toJson(path)),
				...(value.clientTruncated || value.ripgrepTruncated
					? toText(`Showing ${value.files?.length ?? 0} of ${value.totalFiles}`)
					: []),
			];
		case "grep":
			return [
				...Object.values(value.workspaceResults ?? {}).flatMap(toGrep),
				...(value.activeEditorResult ? toGrep(value.activeEditorResult) : []),
			];
		case "ls": {
			const entries = toEntries(value.directoryTreeRoot);
			return [
				...entries.slice(0, MAX_ENTRIES).map(toJson),
				...(entries.length > MAX_ENTRIES
					? toText(`Showing ${MAX_ENTRIES} of ${entries.length} entries`)
					: []),
			];
		}
		case "semSearch":
			return toText(String(value.results ?? ""));
		case "readLints":
			return toText(
				(value.fileDiagnostics ?? [])
					.filter((file: any) => file.diagnostics?.length)
					.map((file: any) =>
						[
							file.path,
							...file.diagnostics.map((item: any) => {
								const start = item.range?.start;
								const at = start?.line
									? `${start.line}:${start.character ?? 0} `
									: "";
								return `  ${at}${item.severity} ${item.message}${item.source ? ` (${item.source})` : ""}`;
							}),
						].join("\n"),
					)
					.join("\n\n") || "No problems found",
			);
		case "generateImage":
			return typeof value.imageData === "string"
				? [
						toFile(
							value.imageData,
							/\.jpe?g$/i.test(value.filePath ?? "")
								? "image/jpeg"
								: /\.webp$/i.test(value.filePath ?? "")
									? "image/webp"
									: "image/png",
						),
					]
				: [];
		case "task": {
			const answer = (value.conversationSteps ?? []).findLast(
				(step: any) => typeof step?.assistantMessage?.text === "string",
			)?.assistantMessage.text;
			return toText(answer ?? String(value.resultSuffix ?? ""));
		}
		// Their changes are found and shown as diffs, their input says the rest.
		case "edit":
		case "write":
		case "delete":
		case "updateTodos":
		case "createPlan":
			return [];
	}
	return toParts(output);
};

const toData = ({ messages }: CursorSubagentProgress): zData =>
	messages.map((message, index) =>
		message.role === "assistant"
			? toParts(message.text)
			: [
					{
						type: "toolCall",
						id: `cursor-${index}`,
						name: message.toolName,
						input: message.input,
					},
					...(message.output === undefined
						? []
						: [
								{
									type: "toolResult" as const,
									id: `cursor-${index}`,
									name: message.toolName,
									output: toOutput(message.toolName, message.output),
									error: message.isError,
								},
							]),
				],
	);

/** Cursor's local agent, with Tiny Chat's tools and an optional native tool set. */
export const createCursorProvider = (
	host: CursorHost | (() => CursorHost | Promise<CursorHost>),
	signIn?: () => Promise<void>,
): ModelProvider<CursorSdk> => {
	const sdk = createCursor({ host });
	let offered: CursorModelInfo[] = [];
	const getModel = (name: string) => offered.find((model) => model.id === name);
	const isNative = (config: { args?: Record<string, unknown> }) =>
		MODES.slice(1).some((mode) => config.args?.["native-mode"] === mode);

	return {
		name: NAME,
		type: "model",
		settings: [],
		keepsContext: true,
		signIn,
		getSdk: () => sdk,
		getLanguageModel: ({ model }) => sdk(model),
		getEmbeddingModel: () => null,
		async getStatus() {
			try {
				const status = await sdk.status();
				if (!status.loggedIn)
					return {
						valid: false,
						error: status.error ?? "Sign in to Cursor to use its models",
						models: [],
					};
				offered = status.models?.length
					? status.models
					: [{ id: "auto-smart" }];
				return {
					valid: true,
					models: offered.map((model) => ({
						name: model.id,
						features: ["language", "language:tools"] as (
							| "language"
							| "language:tools"
						)[],
						args: this.getModelArgs({ model: model.id }),
					})),
				};
			} catch (error) {
				console.error("[CursorProvider] status failed:", error);
				return { valid: false, error: "Failed to reach Cursor", models: [] };
			}
		},
		getModelArgs({ model }) {
			const args: zModelArg[] = ModelProviderUtils.getModelArgs({
				temperature: false,
				tokensOut: false,
			});
			args.push({
				type: "list",
				name: "native-mode",
				values: [...MODES],
				default: "off",
			});
			for (const parameter of getModel(model)?.parameters ?? []) {
				if (!parameter.values.length) continue;
				const preferred = getModel(model)
					?.variants?.find((variant) => variant.isDefault)
					?.params.find((param) => param.id === parameter.id)?.value;
				args.push({
					type: "list",
					name: parameter.id,
					values: parameter.values.map((value) => value.value),
					default:
						parameter.values.find((value) => value.value === preferred)
							?.value ?? parameter.values[0].value,
				});
			}
			return args;
		},
		getSdkOptions({ config, folders }) {
			const { args } = ModelProviderUtils.applyDefaultArgs({
				config: { ...config },
				args: this.getModelArgs({ model: config.model }),
			});
			const native = isNative({ args });
			const sandboxed = args["native-mode"] !== "full-access";
			const [cwd, ...additionalDirectories] = folders ?? [];
			const options: CursorOptions = {
				cwd,
				additionalDirectories,
				// Custom system prompts require account access in Cursor. Keep its
				// base prompt and add Tiny Chat's instructions in either mode.
				systemPromptPreset: "cursor",
				builtinTools: native ? "cursor" : [],
				settingSources: native ? ["all"] : [],
				sandbox: native && sandboxed,
				// Cursor refuses whatever Auto-review won't approve on its own,
				// so it stays off where nothing should be refused.
				autoReview: sandboxed,
				params: (getModel(config.model)?.parameters ?? []).flatMap(
					(parameter) =>
						parameter.values.some((value) => value.value === args[parameter.id])
							? [{ id: parameter.id, value: args[parameter.id] as string }]
							: [],
				),
			};
			return { [NAME]: JSON.parse(JSON.stringify(options)) };
		},
		runsTools: ({ config }) => isNative(config),
		async getPartTransformed({ part }) {
			if (part.type === "interjection" && part.signature?.model === NAME)
				return [];
			if (part.type !== "file") return undefined;
			return [
				await ModelProviderUtils.getPartTransformed({
					part,
					supportedFileTypes: SUPPORTED_FILES,
				}),
			];
		},
		getPartSignature: ({ event }) => signatureOf(event),
		getPartSignatureReturn: ({ part }) =>
			part.signature?.model === NAME && part.signature.metadata
				? { [NAME]: part.signature.metadata }
				: undefined,
		getEventTransformed({ event }) {
			if (
				(event.type === "tool-result" || event.type === "tool-error") &&
				event.providerExecuted
			) {
				const output =
					event.type === "tool-result" ? event.output : event.error;
				if ((output as CursorSubagentProgress | undefined)?.type === "subagent")
					return [
						{
							type: "toolStream",
							id: event.toolCallId,
							data: toData(output as CursorSubagentProgress),
						},
					];
				return [
					{
						type: "data",
						value: {
							type: "toolResult",
							id: event.toolCallId,
							name: event.toolName,
							providerExecuted: true,
							output: toOutput(event.toolName, output),
							error:
								event.type === "tool-error" ||
								(output as { status?: string } | undefined)?.status === "error",
							signature: signatureOf(event),
						},
					},
				];
			}
			if (event.type === "custom" && metadataOf(event)) return [];
			return undefined;
		},
		shouldContinue({ events }) {
			const awaiting = metadataOf(
				events.findLast((event) => event.type === "finish"),
			)?.awaiting;
			return Array.isArray(awaiting) && awaiting.includes("continue");
		},
	};
};
