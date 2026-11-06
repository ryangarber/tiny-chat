import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { useCallback, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { ClientProviderService } from "#client/features/agent/services/ClientProviderService.ts";

const providerCacheQueryKey = ["cache", "providers"] as const;
export const providerCacheMutationKey = ["cache", "providers"] as const;

interface UpdateProvidersVariables {
	/** Only recheck these providers, leaving the rest of the cache alone. */
	providers?: string[];
}

export const useProviders = () => {
	const client = useContext(ClientContext);

	const { session } = useSession();

	const queryKey = [...providerCacheQueryKey, session.data?.user.id];

	const providers = useQuery({
		queryKey,
		queryFn: () => {
			if (!session.data) return [];
			return ClientProviderService.getProviderStates({
				client,
				user: session.data.user,
			});
		},
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const updateProviders = useMutation({
		mutationKey: providerCacheMutationKey,
		mutationFn: async ({ providers: names }: UpdateProvidersVariables) => {
			if (!session.data) throw new Error("missing session");
			console.log("[useProviders] updating providers:", names ?? "all");
			const states = await ClientProviderService.getProviderStates({
				client,
				user: session.data.user,
				update: true,
				providers: names,
			});
			client.queryClient.setQueryData(queryKey, states);
			console.log("[useProviders] updated:", states);
			return states;
		},
	});

	const signIn = useMutation({
		mutationFn: async (name: string) => {
			const provider = providers.data?.find(
				(provider) => provider.name === name,
			);
			if (!provider?.signIn)
				throw new Error("Provider does not support sign-in");
			await provider.signIn();
			await updateProviders.mutateAsync({ providers: [name] });
		},
	});

	const pendingUpdates = useMutationState({
		filters: { mutationKey: providerCacheMutationKey, status: "pending" },
		select: (mutation) =>
			mutation.state.variables as UpdateProvidersVariables | undefined,
	});

	/** Whether any update, or one covering `name`, is in flight. */
	const isUpdating = useCallback(
		(name?: string) =>
			pendingUpdates.some(
				(variables) =>
					!name || !variables?.providers || variables.providers.includes(name),
			),
		[pendingUpdates],
	);

	return { providers, updateProviders, isUpdating, signIn };
};
