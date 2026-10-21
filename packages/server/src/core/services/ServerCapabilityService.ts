import type { Capabilities } from "#core/core/types/capability.ts";
import { CapabilityUtils } from "#core/core/utils/CapabilityUtils.ts";
import type {
	zAgentChat,
	zAgentMessage,
} from "#core/features/agent/types/agent.ts";
import { AgentUtils } from "#core/features/agent/utils/AgentUtils.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import { createActionsCapability } from "#server/core/capabilities/createActionsCapability.ts";
import { createChatShellCapability } from "#server/core/capabilities/createChatShellCapability.ts";
import { createEmbeddingCapability } from "#server/core/capabilities/createEmbeddingCapability.ts";
import { createGitHubCapability } from "#server/core/capabilities/createGitHubCapability.ts";
import { createLegiscanCapability } from "#server/core/capabilities/createLegiscanCapability.ts";
import { createMemoriesCapability } from "#server/core/capabilities/createMemoriesCapability.ts";
import { createSubagentsCapability } from "#server/core/capabilities/createSubagentsCapability.ts";
import { createWebCapability } from "#server/core/capabilities/createWebCapability.ts";
import { CacheService } from "#server/features/user/services/CacheService.ts";

export const ServerCapabilityService = {
	getCapabilities: async ({
		user,
		chat,
		message,
		messages,
		incognito,
		temporary,
		providers,
	}: {
		user: zUser;
		chat: zAgentChat | null | undefined;
		message: MessageState | null | undefined;
		/** What the mount is built from; a chat only adds somewhere to write. */
		messages?: zAgentMessage[];
		incognito: boolean | undefined;
		temporary: boolean | undefined;
		providers?: ProviderState<ProviderStatus>[];
	}): Promise<Capabilities> => {
		providers ??= (await CacheService.getCache({ user })).providers;

		const enabled = CapabilityUtils.getEnabled({
			user,
			providers,
			project: chat?.project,
			chat: !!chat?.id,
			message: !!message?.id,
			incognito,
			temporary,
			// The worker runs nowhere near the user's own machine.
			desktop: false,
		});

		const capabilities: Capabilities = {};

		if (enabled.chatShell) {
			capabilities.chatShell = await createChatShellCapability({
				user,
				chat: chat?.id,
				...AgentUtils.getMounts({ messages: messages ?? [] }),
			});
		}

		if (enabled.legiscan) {
			capabilities.legiscan = await createLegiscanCapability({ user });
		}

		if (enabled.github) {
			capabilities.github = await createGitHubCapability({
				user,
				preferLinkedAccount: !incognito,
			});
		}

		if (enabled.actions) {
			capabilities.actions = await createActionsCapability({ user, message });
		}

		if (enabled.memories) {
			capabilities.memories = await createMemoriesCapability({ user, message });
		}

		if (enabled.embedding) {
			capabilities.embedding = await createEmbeddingCapability({ user });
		}

		if (enabled.subagents) {
			capabilities.subagents = await createSubagentsCapability({
				chat,
				message,
			});
		}

		if (enabled.web) {
			capabilities.web = await createWebCapability({ user });
		}

		return capabilities;
	},
} as const;
