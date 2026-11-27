import {
	Box,
	Button,
	CheckboxCard,
	CheckboxIndicator,
	Group,
	Modal,
	Progress,
	Select,
	Space,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { useMutationState } from "@tanstack/react-query";
import { useState } from "react";
import { useProviders } from "#client/features/agent/hooks/useProviders.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useEmbeddingSettings } from "#client/features/settings/hooks/useEmbeddingSettings.ts";
import { useModelSettings } from "#client/features/settings/hooks/useModelSettings.ts";
import { useProviderSettings } from "#client/features/settings/hooks/useProviderSettings.ts";
import {
	type EmbeddingStatus,
	runEmbeddingBatchMutationKey,
} from "#client/features/user/hooks/useEmbedding.ts";
import type { zConfig } from "#core/features/data/types/message.ts";
import ModelSelect from "#gui/core/components/ModelSelect.tsx";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import { StyleUtils } from "#gui/core/utils/StyleUtils.ts";
import CommandSettings from "#gui/features/sidebar/components/CommandSettings.tsx";
import ContextSettings from "#gui/features/sidebar/components/ContextSettings.tsx";
import FolderSettings from "#gui/features/sidebar/components/FolderSettings.tsx";
import LaunchSettings from "#gui/features/sidebar/components/LaunchSettings.tsx";

export default function ChatSettings({
	embeddingStatus,
}: {
	embeddingStatus: EmbeddingStatus;
}) {
	const { providers } = useProviders();

	const { preferredWebProvider, setPreferredWebProvider } =
		useProviderSettings();
	const {
		embeddingConfig,
		setEmbeddingConfig,
		useEmbeddingSearch,
		setUseEmbeddingSearch,
	} = useEmbeddingSettings();
	const { dreamConfig, setDreamConfig } = useModelSettings();
	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);
	const project = useChatStore((state) => state.active.project);

	const [newEmbeddingConfig, setNewEmbeddingConfig] = useState<zConfig | null>(
		null,
	);

	const runEmbeddingBatchState =
		useMutationState({
			filters: { mutationKey: runEmbeddingBatchMutationKey },
			select: (m) => m.state.status,
		}).at(-1) ?? "idle";

	return (
		<Stack>
			<ContextSettings project={project} />
			<Space />
			<FolderSettings project={project} />
			<Space />
			<CommandSettings project={project} />
			<Space />
			{project && (
				<>
					<LaunchSettings project={project} />
					<Space />
				</>
			)}
			<Box>
				<Text size="sm">Retrieval</Text>
				<Text size="xs" c="dimmed">
					Enables memory and smart search
					{embeddingStatus.totalCount > 0 &&
						` (${embeddingStatus.totalCount.toLocaleString()})`}
				</Text>
				{embeddingStatus.totalCount > 0 && (
					<Progress
						my={5}
						value={
							runEmbeddingBatchState === "error"
								? 100
								: runEmbeddingBatchState === "idle"
									? 0
									: Math.min(
											100,
											(embeddingStatus.batchCount /
												embeddingStatus.totalCount) *
												100,
										)
						}
						color={
							runEmbeddingBatchState === "error"
								? "red"
								: runEmbeddingBatchState === "idle"
									? "gray"
									: undefined
						}
						animated={runEmbeddingBatchState === "pending"}
					/>
				)}
			</Box>
			<Tooltip label="Model that generates embeddings" position="right">
				<ModelSelect
					label="Embedding Model"
					styles={StyleUtils.input}
					optional
					configValue={embeddingConfig}
					onConfigChange={(value) => {
						setNewEmbeddingConfig(value ?? null);
						setCurrentModal("embedding-config");
					}}
					feature="embedding"
					disabled={
						currentModal === "embedding-config" || setEmbeddingConfig.isPending
					}
					readOnly={
						currentModal === "embedding-config" || setEmbeddingConfig.isPending
					}
				/>
			</Tooltip>
			<Modal
				title="Change Embedding Model"
				opened={currentModal === "embedding-config"}
				onClose={() => setCurrentModal(null)}
				styles={{ content: StyleUtils.input }}
				centered
			>
				{newEmbeddingConfig ? (
					<Text>
						All embeddings will be regenerated using the model{" "}
						<strong>{newEmbeddingConfig.model}</strong>.
					</Text>
				) : (
					<Text>
						Features like memory and smart search will not be available.
					</Text>
				)}
				<Button
					variant="gradient"
					fullWidth
					onClick={() => {
						setEmbeddingConfig.mutate({ config: newEmbeddingConfig });
						setCurrentModal(null);
					}}
					mt="lg"
					disabled={setEmbeddingConfig.isPending}
					loading={setEmbeddingConfig.isPending}
				>
					Confirm
				</Button>
			</Modal>
			<Tooltip
				label={
					embeddingConfig
						? "Considers semantic meaning of text"
						: "Requires embedding model"
				}
				position="right"
			>
				<CheckboxCard
					p="xs"
					checked={useEmbeddingSearch}
					onChange={(value) => {
						setUseEmbeddingSearch.mutate({
							useEmbeddingSearch: value,
						});
					}}
					disabled={!embeddingConfig || setUseEmbeddingSearch.isPending}
					style={{
						cursor: !embeddingConfig ? "not-allowed" : "pointer",
					}}
				>
					<Group>
						<CheckboxIndicator size="xs" />
						<Text size="sm">Smart Search</Text>
					</Group>
				</CheckboxCard>
			</Tooltip>
			<Space />
			<Box>
				<Text size="sm">Agents</Text>
				<Text size="xs" c="dimmed">
					Enables various agentic features
				</Text>
			</Box>
			<Tooltip label="Model used for forming memories" position="right">
				<ModelSelect
					label="Dreaming Model"
					styles={StyleUtils.input}
					optional
					configValue={dreamConfig}
					onConfigChange={(value) => setDreamConfig.mutate({ config: value })}
					feature="language"
					loading={setDreamConfig.isPending}
					disabled={setDreamConfig.isPending}
				/>
			</Tooltip>
			<Space />
			<Box>
				<Text size="sm">Web</Text>
				<Text size="xs" c="dimmed">
					Enables web browsing for chat models
				</Text>
			</Box>
			<Tooltip label="Provider used for web browsing" position="right">
				<Select
					label="Preferred Provider"
					styles={StyleUtils.input}
					allowDeselect={false}
					data={
						providers.data
							?.filter(
								(provider) => provider.type === "web" && provider.status.valid,
							)
							.map((p) => p.name) ?? []
					}
					value={preferredWebProvider}
					onChange={(value) => {
						if (!value) return;
						setPreferredWebProvider.mutate({
							preferredWebProvider: value,
						});
					}}
					disabled={setPreferredWebProvider.isPending}
					readOnly={setPreferredWebProvider.isPending}
				/>
			</Tooltip>
		</Stack>
	);
}
