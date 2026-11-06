import type { FilePart, ModelMessage, TextStreamPart } from "ai";
import { z } from "zod";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { AgentMessagesService } from "#core/features/agent/services/AgentMessagesService.ts";
import type { zAgentEvent } from "#core/features/agent/types/agent.ts";
import { AgentUtils } from "#core/features/agent/utils/AgentUtils.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import {
	type zDataPart,
	zDataSimplePart,
} from "#core/features/data/types/part.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { DataUtils } from "#core/features/data/utils/DataUtils.ts";
import type {
	ModelProvider,
	zModelMessage,
} from "#core/features/provider/types/model.ts";
import { ModelProviderUtils } from "#core/features/provider/utils/ModelProviderUtils.ts";
import { ToolCallUtils } from "#core/features/tool/utils/ToolCallUtils.ts";

type SdkPart =
	| Exclude<Exclude<ModelMessage["content"][number], string>, FilePart>
	| (FilePart & { data: Extract<FilePart["data"], { type: "data" }> });

type SdkBasicPart = Extract<SdkPart, { type: "text" | "file" }>;

type SdkMessage = ModelMessage & {
	content: SdkPart[];
};

export const ModelTransformService = {
	toSdkMessages: async ({
		user,
		provider,
		messages,
		config,
	}: {
		user: zUser;
		provider: ModelProvider<any>;
		messages: zModelMessage[];
		config: zConfig;
	}): Promise<SdkMessage[]> => {
		const sdkMessages: SdkMessage[] = [];
		for (const message of messages) {
			const sdkMessage: SdkMessage = {
				role: message.author === "MODEL" ? "assistant" : "user",
				content: [],
			};

			// transform based on model: full parts at the root, 'basic' parts for
			// everything inside. Awaited because a document attached to a model
			// that cannot read one is unpacked here.
			async function transform(part: zDataPart): Promise<zDataPart[]>;
			async function transform(
				part: zDataSimplePart,
			): Promise<zDataSimplePart[]>;
			async function transform(
				part: zDataPart,
			): Promise<zDataPart[] | zDataSimplePart[]> {
				let result =
					(await provider.getPartTransformed?.({ user, config, part })) ??
					(await ModelProviderUtils.getPartTransformed({ part }));
				if (!Array.isArray(result)) result = [result];
				return result;
			}

			/** `flatMap` over an async mapper, in order. */
			async function flatMap<T, R>(
				items: T[],
				map: (item: T) => Promise<R[]>,
			): Promise<R[]> {
				return (await Promise.all(items.map(map))).flat();
			}

			// Sorted again here so a message saved out of order still sends. A
			// checkpoint is told to the model like a note from the user, so it
			// knows it is picking up from one.
			const parts = message.data
				.flatMap((slot) => AgentUtils.getToolResultsSorted({ data: slot }))
				.map(
					(part): zDataPart =>
						DataUtils.isCheckpoint(part)
							? {
									id: part.id,
									type: "interjection",
									value: [
										{
											id: part.id,
											type: "text",
											value: DataUtils.getCheckpointNotice(),
										},
									],
								}
							: part,
				);

			for (const part of parts) {
				const role =
					part.type === "toolResult" && !part.providerExecuted
						? "tool"
						: part.type === "interjection"
							? "user"
							: message.author === "MODEL"
								? "assistant"
								: "user";

				// if transitioning between toolResult and non-toolResult blocks, push and reset
				if (sdkMessage.role !== role && sdkMessage.content.length) {
					sdkMessages.push({ ...sdkMessage });
					sdkMessage.content = [];
				}

				// correctly assign the author for the current block
				sdkMessage.role = role;

				let providerOptions = provider.getPartSignatureReturn?.({
					user,
					config,
					part,
				});
				providerOptions =
					ModelProviderUtils.getSignatureReturnPruned(providerOptions);

				// convert to sdk parts with an equivalent basic/non-basic distinction
				async function toSdkPart(part: zDataPart): Promise<SdkPart[]>;
				async function toSdkPart(
					part: zDataSimplePart,
				): Promise<SdkBasicPart[]>;
				async function toSdkPart(
					part: zDataPart,
				): Promise<SdkPart[] | SdkBasicPart[]> {
					if (part.type === "interjection") {
						const notice: SdkBasicPart[] = part.task
							? [
									{
										type: "text",
										text: ToolCallUtils.getBackgroundNotice({
											task: part.task,
										}),
									},
								]
							: [];
						return [
							...notice,
							...(await flatMap(
								await flatMap(part.value, transform),
								toSdkPart,
							)),
						];
					} else if (part.type === "attachment") {
						return await flatMap(
							await flatMap(
								AgentMessagesService.buildAttachmentParts(part),
								(value) => transform(value),
							),
							(value) => toSdkPart(value),
						);
					} else if (part.type === "text") {
						return [{ type: "text", text: part.value, providerOptions }];
					} else if (part.type === "json") {
						return [
							{
								type: "text",
								text: `\`\`\`json\n${JSON.stringify(part.value)}\n\`\`\``,
								providerOptions,
							},
						];
					} else if (part.type === "file") {
						return [
							{
								type: "file",
								filename: part.name,
								mediaType: part.mime,
								data: { type: "data", data: part.data },
								providerOptions,
							},
						];
					} else {
						if (part.type === "thought") {
							return [
								{
									type: "reasoning",
									text: part.value,
									providerOptions,
								},
							];
						} else if (part.type === "toolCall") {
							return [
								{
									type: "tool-call",
									toolCallId: part.id,
									toolName: part.name,
									input: part.input,
									...(part.providerExecuted && { providerExecuted: true }),
									providerOptions,
								},
								// Asked about by the provider, which reads the user's
								// answer after the message.
								...(part.providerExecuted && part.validation?.approval
									? [
											{
												type: "tool-approval-request" as const,
												approvalId: part.id,
												toolCallId: part.id,
											},
										]
									: []),
							];
						} else if (part.type === "toolResult") {
							const parsed = z.array(zDataSimplePart).safeParse(part.output);
							return [
								{
									type: "tool-result",
									toolCallId: part.id,
									toolName: part.name,
									output: part.error
										? { type: "error-json", value: part.output }
										: parsed.success
											? {
													type: "content",
													value: await flatMap(
														await flatMap(parsed.data, transform),
														toSdkPart,
													),
												}
											: { type: "json", value: part.output },
									providerOptions,
								},
							];
						}
					}
					return [];
				}

				sdkMessage.content.push(
					...(await flatMap(await transform(part), (part) => toSdkPart(part))),
				);
			}

			if (sdkMessage.content.length) {
				sdkMessages.push(sdkMessage);
			}

			// The user's answers to approvals the provider asked for, for calls
			// it hasn't run since: they go back to it with the next step.
			const all = message.data.flat();
			const approvals = all.flatMap((part): SdkPart[] =>
				part.type === "toolCall" &&
				part.providerExecuted &&
				part.validation?.approved !== undefined &&
				!all.some((p) => p.type === "toolResult" && p.id === part.id)
					? [
							{
								type: "tool-approval-response",
								approvalId: part.id,
								approved: part.validation.approved,
								providerExecuted: true,
							},
						]
					: [],
			);
			if (approvals.length)
				sdkMessages.push({ role: "tool", content: approvals } as SdkMessage);
		}

		return sdkMessages;
	},

	fromSdkEvent: ({
		user,
		provider,
		config,
		event,
	}: {
		user: zUser;
		provider: ModelProvider<any>;
		config: zConfig;
		event: TextStreamPart<any>;
	}): zAgentEvent | null => {
		const signature = ModelProviderUtils.getSignaturePruned(
			provider.getPartSignature?.({ user, config, event }),
		);

		if (
			event.type === "reasoning-start" ||
			event.type === "reasoning-delta" ||
			event.type === "reasoning-end"
		) {
			return {
				type: "data",
				value: {
					type: "thought",
					id: event.id,
					value: "text" in event ? event.text : "",
					signature,
				},
			};
		} else if (
			event.type === "text-start" ||
			event.type === "text-delta" ||
			event.type === "text-end"
		) {
			return {
				type: "data",
				value: {
					type: "text",
					id: "id" in event ? event.id : "",
					value: "text" in event ? event.text : "",
					signature,
				},
			};
		} else if (event.type === "file") {
			return {
				type: "data",
				value: {
					id: CommonUtils.getRandomId(),
					type: "file",
					mime: event.file.mediaType,
					data: event.file.base64,
					signature,
				},
			};
		} else if (event.type === "tool-input-start") {
			return { type: "toolInput", id: event.id, name: event.toolName };
		} else if (event.type === "tool-input-delta") {
			return { type: "toolInput", id: event.id, delta: event.delta };
		} else if (event.type === "tool-call") {
			return {
				type: "data",
				value: {
					type: "toolCall",
					name: event.toolName,
					id: event.toolCallId,
					input: event.input,
					...(event.providerExecuted && { providerExecuted: true }),
					signature,
				},
			};
		} else if (event.type === "tool-result") {
			return {
				type: "data",
				value: {
					type: "toolResult",
					name: event.toolName,
					id: event.toolCallId,
					...(event.providerExecuted && { providerExecuted: true }),
					signature,
					output: [
						{
							id: CommonUtils.getRandomId(),
							type: "json",
							value: event.output,
						},
					],
				},
			};
		}

		if (event.type === "finish" && event.finishReason === "error") {
			throw new Error(`${event.finishReason}: ${event.rawFinishReason}`);
		} else if (event.type === "error") {
			throw event.error;
		} else if (
			event.type === "finish" &&
			(event.finishReason === "length" ||
				event.finishReason === "content-filter" ||
				event.finishReason === "other")
		) {
			return {
				type: "data",
				value: {
					id: CommonUtils.getRandomId(),
					type: "abort",
					reason:
						event.finishReason === "content-filter"
							? "content"
							: event.finishReason,
					message:
						"rawFinishReason" in event ? event.rawFinishReason : undefined,
				},
			};
		}

		return null;
	},
} as const;
