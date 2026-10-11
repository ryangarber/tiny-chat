import type { Capabilities } from "#core/core/types/capability.ts";
import { SettingsUtils } from "#core/core/utils/SettingsUtils.ts";
import type { zAgentChat } from "#core/features/agent/types/agent.ts";
import type { zUser } from "#core/features/data/types/user.ts";
import { WebProviderService } from "#core/features/provider/services/WebProviderService.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import type { zWebFeature } from "#core/features/provider/types/web.ts";
import { ProviderUtils } from "#core/features/provider/utils/ProviderUtils.ts";

export type CapabilityName = keyof Capabilities;

/** Which capabilities a message is entitled to, whether or not they are built. */
export type CapabilitySet = Record<CapabilityName, boolean>;

/**
 * What a message's capabilities are decided from — facts about the message and
 * the host, never the capability objects themselves.
 *
 * `chat` and `message` mean "there is a row for this, or there will be by the
 * time the message runs", which is what lets an unsent message be costed with
 * the capabilities it is actually going to have.
 */
export interface CapabilityConditions {
	user: zUser;
	providers: ProviderState<ProviderStatus>[];
	/** The folder of the chat the message runs in; its settings win over the user's. */
	project?: zAgentChat["project"];
	chat: boolean;
	message: boolean;
	incognito: boolean | undefined;
	temporary: boolean | undefined;
	/** Whether the host can reach the user's own machine. */
	desktop: boolean;
}

export const CapabilityUtils = {
	/**
	 * The one answer to "what may this message do", shared by the server worker,
	 * the client, and the client asking what a message will cost before it is
	 * sent. Hosts build what they can of it and leave out the rest.
	 */
	getEnabled: ({
		user,
		providers,
		project,
		chat,
		message,
		incognito,
		temporary,
		desktop,
	}: CapabilityConditions): CapabilitySet => {
		const settings = SettingsUtils.of(user, project);

		return {
			chatShell: true,
			github: true,
			shell: desktop,
			browser: desktop,
			actions: !incognito && message,
			memories: !incognito,
			web: (["search", "view"] satisfies zWebFeature[]).some(
				(feature) =>
					!!WebProviderService.getBestProvider({ user, providers, feature }),
			),
			embedding: !!ProviderUtils.isValid(providers, settings.embeddingConfig),
			subagents:
				chat &&
				message &&
				!!ProviderUtils.isValid(providers, settings.subagentConfig),
			persistence: !incognito && !temporary,
		};
	},

	/**
	 * Unwrap a row a capability acts through. A capability enabled for a message
	 * that is not saved yet is still built — that is how the message gets costed
	 * — but it has nothing to write to, and this is what it says if it is ever
	 * asked to.
	 */
	require: <T>(
		value: T | null | undefined,
		capability: CapabilityName,
	): NonNullable<T> => {
		if (value === null || value === undefined) {
			throw new Error(
				`The ${capability} capability cannot be used until the chat and message are saved`,
			);
		}
		return value;
	},
} as const;
