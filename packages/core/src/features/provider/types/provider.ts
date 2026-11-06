import { z } from "zod";
import type { zUser } from "#core/features/data/types/user.ts";

const zProvider = z.object({
	name: z.string(),
	type: z.enum(["model", "web", "other"]),
	settings: z.array(z.string()),
});
type zProvider = z.infer<typeof zProvider>;

export interface ProviderStatus {
	valid: boolean;
	error?: string;
}

export interface Provider<T extends ProviderStatus = ProviderStatus>
	extends zProvider {
	/** Interactive sign-in on the local host; resolves after credentials are saved. */
	signIn?: () => Promise<void>;
	getStatus: ({ user }: { user: zUser }) => Promise<T>;
}

export interface ProviderState<T extends ProviderStatus = ProviderStatus>
	extends zProvider,
		Pick<Provider, "signIn"> {
	status: T;
}
