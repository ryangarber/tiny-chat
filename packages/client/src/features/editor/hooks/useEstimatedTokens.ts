import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCapabilities } from "#client/core/hooks/useCapabilities.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useStableKey } from "#client/core/hooks/useStableKey.ts";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { useSkills } from "#client/features/agent/hooks/useSkills.ts";
import { useTools } from "#client/features/agent/hooks/useTools.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { AgentService } from "#core/features/agent/services/AgentService.ts";
import {
	AgentTokensService,
	type CompactionResult,
} from "#core/features/agent/services/AgentTokensService.ts";
import type { zAgentMessage } from "#core/features/agent/types/agent.ts";
import type { zData } from "#core/features/data/types/part.ts";

export type UsageLevel = "low" | "moderate" | "high";

export type Categories = { name: string; tokens: number; loading: boolean }[];

export type Usage<T> = {
	percent: number;
	level: UsageLevel;
	color: T;
	loading: boolean;
};

const ZERO: CompactionResult = {
	before: AgentTokensService.zero,
	compaction: new Map(),
	after: AgentTokensService.zero,
	messages: [],
};

export const chatTokensQueryKey = [
	"useEstimatedTokens",
	"estimatedTokens",
] as const;

export const useEstimatedTokens = <T>({
	draft,
	colors,
}: {
	draft: zData;
	colors?: Partial<Record<UsageLevel, T>>;
}) => {
	const { session } = useSession();
	const { nextChat } = useChat();
	const { config: baseConfig, model, modelArgs, providers } = useConfig();
	const { toolsets, nativeTools, mcpTools } = useTools();
	const { skills, localSkills, nativeSkills } = useSkills();
	const editing = useComposerStore((state) =>
		state.mode.kind === "edit" ? state.mode.message : null,
	);

	const config = useMemo(() => {
		return {
			...baseConfig,
			args: {
				...baseConfig.args,
				"tokens-in":
					baseConfig.args["tokens-in"] ??
					modelArgs.find((arg) => arg.name === "tokens-in")?.default,
			},
		};
	}, [baseConfig, modelArgs]);

	// Stamped once per draft, as it is taken in: a new time on every config
	// change would key a new estimate each render that hands this a fresh config
	// object.
	const [debounced, setDebounced] = useState(() => ({
		draft,
		createdAt: Temporal.Now.plainDateTimeISO("UTC"),
	}));
	const debouncedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (debouncedTimeout.current) {
			clearTimeout(debouncedTimeout.current);
		}
		debouncedTimeout.current = setTimeout(() => {
			setDebounced({ draft, createdAt: Temporal.Now.plainDateTimeISO("UTC") });
		}, 1000);
		return () => {
			if (debouncedTimeout.current) {
				clearTimeout(debouncedTimeout.current);
			}
		};
	}, [draft]);

	/**
	 * The message being written, counted as a message. Its attachments are read
	 * off the mount like any other, which is what lets an upload attached here
	 * cost what it will cost before it is sent.
	 */
	const draftMessage = useMemo(
		(): zAgentMessage[] => [
			{
				id: null,
				author: "USER",
				config,
				data: debounced.draft,
				createdAt: debounced.createdAt,
			},
		],
		[config, debounced],
	);

	const { capabilities, sourceMessages } = useCapabilities({
		future: false,
		draft: draftMessage,
	});

	const estimateMessages = useMemo(
		() => [
			...(sourceMessages.data?.messages.filter(
				(message) => message.id !== editing?.id,
			) ?? []),
			...draftMessage,
		],
		[sourceMessages.data?.messages, editing?.id, draftMessage],
	);
	const estimateKey = useStableKey({
		messages: estimateMessages,
		capabilities: capabilities.data,
		toolsets,
		skills,
		config,
		chat: nextChat,
	});
	const dependenciesLoading =
		session.isFetching ||
		providers.isFetching ||
		sourceMessages.isFetching ||
		capabilities.isFetching ||
		nativeTools.isFetching ||
		mcpTools.isFetching ||
		localSkills.isFetching ||
		nativeSkills.isFetching;
	const dependenciesReady =
		!!session.data &&
		providers.isSuccess &&
		// A new chat has no history to load: its query is disabled, and so never
		// succeeds.
		(sourceMessages.isSuccess || !sourceMessages.isEnabled) &&
		capabilities.isSuccess &&
		nativeTools.isSuccess &&
		mcpTools.isSuccess &&
		localSkills.isSuccess &&
		nativeSkills.isSuccess;
	const supportsTools = model?.features.includes("language:tools") ?? false;

	const chatTokens = useQuery({
		queryKey: [
			...chatTokensQueryKey,
			session.data?.user.id,
			supportsTools,
			estimateKey,
		],
		queryFn: async (): Promise<CompactionResult> => {
			if (!session.data) return ZERO;

			return await AgentService.estimate({
				context: {
					user: session.data.user,
					chat: nextChat,
					messages: estimateMessages,
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					interactive: true,
				},
				config,
				capabilities: capabilities.data ?? {},
				toolsets,
				skills,
				supportsTools,
			});
		},
		enabled: dependenciesReady,
		// Each input change keys a new estimate; hold the last total meanwhile
		// rather than dropping to zero.
		placeholderData: keepPreviousData,
		throwOnError: true,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	});
	// Kept as an alias for callers that previously observed both queries. The
	// estimate is deliberately one build now: generation never sends history and
	// the draft as two independent prompts.
	const draftTokens = chatTokens;

	const { totalTokens, usage } = useMemo<{
		totalTokens: number;
		usage: Usage<T>;
	}>(() => {
		const totalTokens = chatTokens.data?.before.total ?? 0;
		const maxTokens =
			config.args?.["tokens-in"] !== undefined
				? Number(config.args["tokens-in"])
				: undefined;
		const percent =
			maxTokens !== undefined ? (totalTokens / maxTokens) * 100 : 0;
		let level: UsageLevel = "low";
		if (percent >= 75) level = "moderate";
		if (percent >= 100) level = "high";
		const color = colors?.[level] ?? ("" as T);
		const loading = dependenciesLoading || chatTokens.isFetching;
		return { totalTokens, usage: { percent, level, color, loading } };
	}, [
		chatTokens.data,
		chatTokens.isFetching,
		dependenciesLoading,
		config,
		colors,
	]);

	const before = chatTokens.data?.before;
	const categoriesLoading = dependenciesLoading || chatTokens.isFetching;
	const categories = useMemo<Categories>(
		() =>
			(
				[
					["Instructions", before?.instructions],
					["Memories", before?.memories],
					["Thoughts", before?.thoughts],
					["Tools", before?.tools],
					["Text", before?.text],
					["Files", before?.files],
				] as const
			).map(([name, tokens]) => ({
				name,
				tokens: tokens ?? 0,
				loading: categoriesLoading,
			})),
		[before, categoriesLoading],
	);

	return { chatTokens, draftTokens, totalTokens, usage, categories };
};
