import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import type {
	ModelProviderStatus,
	zModelFeature,
} from "#core/features/provider/types/model.ts";
import type { ProviderState } from "#core/features/provider/types/provider.ts";
import Choice, {
	type ChoiceItem,
} from "#tui/features/settings/components/Choice.tsx";

type Model = Pick<zConfig, "provider" | "model">;

/**
 * A choice of one model that can do `feature`, picked from the valid
 * providers — or of none, when `onClear` puts it back to the default.
 */
export default function ModelChoice({
	feature,
	current,
	onSelect,
	onClear,
}: {
	feature: Exclude<zModelFeature, "language:tools">;
	current: Model | null | undefined;
	onSelect: (model: Model) => void;
	onClear?: () => void;
}) {
	const { providers } = useProviders();

	return (
		<Choice<ChoiceItem & { config: Model | null }>
			tabs
			groups={[
				...(onClear
					? [
							{
								items: [
									{
										name: "(default)",
										value: "",
										config: null,
										active: !current,
									},
								],
							},
						]
					: []),
				...(providers.data ?? [])
					.filter(
						(provider): provider is ProviderState<ModelProviderStatus> =>
							provider.type === "model" && provider.status.valid,
					)
					.map((provider) => ({
						name: provider.name,
						items: provider.status.models
							.filter((model) => model.features.includes(feature))
							.map((model) => ({
								name: model.name,
								value: `${provider.name}/${model.name}`,
								config: { provider: provider.name, model: model.name },
								active:
									current?.provider === provider.name &&
									current.model === model.name,
							})),
					})),
			]}
			onSelect={({ config }) => (config ? onSelect(config) : onClear?.())}
		/>
	);
}
