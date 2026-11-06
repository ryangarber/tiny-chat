import {
	ActionIcon,
	Box,
	Button,
	Card,
	Collapse,
	Group,
	Space,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import {
	ArrowClockwiseIcon,
	CaretDownIcon,
	CaretRightIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import { useProviderSettings } from "#client/features/settings/hooks/useProviderSettings.ts";
import type {
	ProviderState,
	ProviderStatus,
} from "#core/features/provider/types/provider.ts";
import SaveButton from "#gui/core/components/SaveButton.tsx";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import { StyleUtils } from "#gui/core/utils/StyleUtils.ts";

function getSummary(provider: ProviderState<ProviderStatus>) {
	const status = provider.status;
	if ("models" in status) {
		const models = status.models as unknown[];
		return `${models.length} ${models.length === 1 ? "model" : "models"}`;
	}
	if ("features" in status) {
		const features = status.features as string[];
		return features.join(", ") || "No features";
	}
	if (!status.valid) return "Not connected";
	return "Connected";
}

function ProviderSetting({
	provider,
	setting,
	value,
}: {
	provider: string;
	setting: string;
	value: string;
}) {
	// Its own mutation, so only this setting waits on it.
	const { setProviderSetting } = useProviderSettings();
	const [draft, setDraft] = useState(value);
	const dirty = draft !== value;
	const saving = setProviderSetting.isPending;

	const save = () => {
		if (!dirty) return;
		setProviderSetting.mutate({ provider, key: setting, value: draft });
	};

	return (
		<TextInput
			label={setting}
			styles={StyleUtils.input}
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onKeyDown={ControlUtils.onEnter(save)}
			rightSection={
				<SaveButton dirty={dirty} loading={saving} onClick={save} />
			}
			disabled={saving}
			readOnly={saving}
		/>
	);
}

function ProviderCard({
	provider,
}: {
	provider: ProviderState<ProviderStatus>;
}) {
	const { providerSettings } = useProviderSettings();
	const { updateProviders, isUpdating, signIn } = useProviders();

	const [expanded, setExpanded] = useState(false);

	const updating = isUpdating(provider.name);
	const signingIn = signIn.isPending;
	const disabled = updating || signingIn;

	return (
		<Card withBorder padding={0}>
			<Box
				role="button"
				tabIndex={0}
				p="xs"
				w="100%"
				style={{ cursor: "pointer" }}
				onClick={() => setExpanded((value) => !value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						setExpanded((value) => !value);
					}
				}}
			>
				<Group wrap="nowrap" align="flex-start">
					<Box pt={2}>
						{expanded ? (
							<CaretDownIcon size={16} />
						) : (
							<CaretRightIcon size={16} />
						)}
					</Box>
					<Stack gap={5} miw={0} flex={1}>
						<Text size="xs">{provider.name}</Text>
						<Text size="xs" c="dimmed">
							{updating ? "Checking…" : getSummary(provider)}
						</Text>
						{!!provider.status.error && (
							<Group gap="xs" c="red" wrap="nowrap">
								<Box>
									<WarningCircleIcon size={14} />
								</Box>
								<Text size="xs">{provider.status.error}</Text>
							</Group>
						)}
					</Stack>
					<Tooltip label={`Check ${provider.name}`} position="left">
						<ActionIcon
							variant="transparent"
							c="dimmed"
							aria-label={`Check ${provider.name}`}
							loading={updating}
							disabled={disabled}
							onClick={(event) => {
								event.stopPropagation();
								updateProviders.mutate({ providers: [provider.name] });
							}}
						>
							<ArrowClockwiseIcon size={18} />
						</ActionIcon>
					</Tooltip>
				</Group>
			</Box>
			<Collapse expanded={expanded}>
				<Stack px="xs" pb="xs" gap="xs">
					{provider.signIn && (
						<Button
							size="xs"
							variant="light"
							loading={signingIn}
							disabled={updating}
							onClick={() => signIn.mutate(provider.name)}
						>
							Sign in to {provider.name}
						</Button>
					)}
					{signIn.error && (
						<Text size="xs" c="red">
							{signIn.error.message}
						</Text>
					)}
					{provider.settings.map((key) => {
						const value = providerSettings?.[provider.name]?.[key] ?? "";
						return (
							// Keyed by its value too, so a saved or loaded value replaces the draft.
							<ProviderSetting
								key={`${provider.name}:${key}:${value}`}
								provider={provider.name}
								setting={key}
								value={value}
							/>
						);
					})}
				</Stack>
			</Collapse>
		</Card>
	);
}

function Providers({
	providers,
}: {
	providers: ProviderState<ProviderStatus>[];
}) {
	return (
		<Stack gap="xs">
			{providers
				.filter((provider) => provider.settings.length || provider.signIn)
				.map((provider) => (
					<ProviderCard key={provider.name} provider={provider} />
				))}
		</Stack>
	);
}

export default function KeysSettings() {
	const { providers, updateProviders, isUpdating } = useProviders();

	const areProvidersUpdating = isUpdating();

	return (
		<Stack>
			<Group justify="space-between">
				<Box>
					<Text size="sm">Chat</Text>
					<Text size="xs" c="dimmed">
						Access chat and embedding models
					</Text>
				</Box>
				<Tooltip label="Check for new models" position="right">
					<ActionIcon
						variant="transparent"
						c="dimmed"
						onClick={() => updateProviders.mutate({})}
						loading={areProvidersUpdating}
						disabled={areProvidersUpdating}
					>
						<ArrowClockwiseIcon size={20} />
					</ActionIcon>
				</Tooltip>
			</Group>
			<Providers
				providers={
					providers.data?.filter((provider) => provider.type === "model") ?? []
				}
			/>
			<Space />
			<Box>
				<Text size="sm">Web</Text>
				<Text size="xs" c="dimmed">
					Enable web browsing for chat models
				</Text>
			</Box>
			<Providers
				providers={
					providers.data?.filter((provider) => provider.type === "web") ?? []
				}
			/>
			{(providers.data?.filter(
				(provider) => provider.type === "other" && provider.settings.length > 0,
			).length ?? 0) > 0 && (
				<>
					<Space />
					<Box>
						<Text size="sm">Other</Text>
						<Text size="xs" c="dimmed">
							Enable extra features and integrations
						</Text>
					</Box>
					<Providers
						providers={
							providers.data?.filter(
								(provider) =>
									provider.type === "other" && provider.settings.length > 0,
							) ?? []
						}
					/>
				</>
			)}
		</Stack>
	);
}
