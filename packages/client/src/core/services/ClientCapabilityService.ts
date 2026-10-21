import type { Client } from "#client/client.ts";
import { createActionsCapability } from "#client/core/capabilities/createActionsCapability.ts";
import { createBrowserCapability } from "#client/core/capabilities/createBrowserCapability.ts";
import { createChatShellCapability } from "#client/core/capabilities/createChatShellCapability.ts";
import { createEmbeddingCapability } from "#client/core/capabilities/createEmbeddingCapability.ts";
import { createGitHubCapability } from "#client/core/capabilities/createGitHubCapability.ts";
import { createLegiscanCapability } from "#client/core/capabilities/createLegiscanCapability.ts";
import { createMemoriesCapability } from "#client/core/capabilities/createMemoriesCapability.ts";
import { createShellCapability } from "#client/core/capabilities/createShellCapability.ts";
import { createSubagentsCapability } from "#client/core/capabilities/createSubagentsCapability.ts";
import { createWebCapability } from "#client/core/capabilities/createWebCapability.ts";
import { ClientProviderService } from "#client/features/agent/services/ClientProviderService.ts";
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
import type { zSkill } from "#core/features/skill/types/skill.ts";
import type { Toolset } from "#core/features/tool/types/tool.ts";

export const ClientCapabilityService = {
	getCapabilities: async ({
		client,
		user,
		chat,
		message,
		messages,
		incognito,
		temporary,
		providers,
		skills = [],
		mcpTools = [],
		presumed = false,
	}: {
		client: Client;
		user: zUser;
		chat: zAgentChat | null | undefined;
		message: MessageState | null | undefined;
		/** What the mount is built from; a chat only adds somewhere to write. */
		messages?: zAgentMessage[];
		incognito: boolean | undefined;
		temporary: boolean | undefined;
		providers?: ProviderState<ProviderStatus>[];
		skills?: zSkill[];
		mcpTools?: Toolset<any>[];
		/**
		 * Gate as if the chat and the prompt message already existed, for working
		 * out what a message costs before it is sent. The capabilities are still
		 * built from what exists now, so the ones that would write to a message
		 * that is not there yet are built unable to.
		 */
		presumed?: boolean;
	}): Promise<Capabilities> => {
		providers ??= await ClientProviderService.getProviderStates({
			client,
			user,
		});

		const enabled = CapabilityUtils.getEnabled({
			user,
			providers,
			project: chat?.project,
			chat: presumed || !!chat?.id,
			message: presumed || !!message?.id,
			incognito,
			temporary,
			desktop: !!client.desktop,
		});

		const capabilities: Capabilities = {};

		if (enabled.chatShell) {
			capabilities.chatShell = await createChatShellCapability({
				client,
				chat: chat?.id,
				...AgentUtils.getMounts({ messages: messages ?? [] }),
			});
		}

		if (enabled.legiscan) {
			capabilities.legiscan = await createLegiscanCapability({ client });
		}

		if (enabled.github) {
			capabilities.github = await createGitHubCapability({
				client,
				preferLinkedAccount: !incognito,
			});
		}

		if (enabled.shell) {
			capabilities.shell = await createShellCapability({ client });
		}

		if (enabled.browser) {
			capabilities.browser = await createBrowserCapability({ client });
		}

		if (enabled.actions) {
			capabilities.actions = await createActionsCapability({ client, message });
		}

		if (enabled.memories) {
			capabilities.memories = await createMemoriesCapability({
				client,
				message,
			});
		}

		if (enabled.embedding) {
			capabilities.embedding = await createEmbeddingCapability({
				client,
				user,
			});
		}

		if (enabled.subagents) {
			capabilities.subagents = await createSubagentsCapability({
				client,
				chat,
				message,
				providers,
				skills,
				mcpTools,
			});
		}

		if (enabled.web) {
			capabilities.web = await createWebCapability({ client });
		}

		return capabilities;
	},
} as const;
