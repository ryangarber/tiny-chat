import {
	ActionIcon,
	Button,
	type DefaultMantineColor,
	Popover,
	Text,
} from "@mantine/core";
import {
	GearIcon,
	PaperPlaneTiltIcon,
	StopIcon,
	TerminalIcon,
} from "@phosphor-icons/react";
import { useEffect } from "react";
import { AgentStreamService } from "#client/core/services/StreamService.ts";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { useStreamStore } from "#client/features/agent/stores/useStreamStore.ts";
import { useChat } from "#client/features/chat/hooks/useChat.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import type {
	Categories,
	Usage,
} from "#client/features/editor/hooks/useEstimatedTokens.ts";
import { useComposerStore } from "#client/features/editor/stores/useComposerStore.ts";
import { useShellCommand } from "#client/features/shell/hooks/useShellCommand.ts";
import { AppService } from "#gui/core/services/AppService.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import ConfigPanel from "#gui/features/editor/components/ConfigPanel.tsx";
import TokenUsage from "#gui/features/editor/components/TokenUsage.tsx";
import { useEditorStore } from "#gui/features/editor/stores/useEditorStore.ts";

export default function RightSection({
	width,
	disabled,
	usage,
	categories,
	hidden,
}: {
	width: number;
	disabled: boolean;
	usage: Usage<DefaultMantineColor>;
	categories: Categories;
	/**
	 * Drawn but faded out, while the editor shows its twin elsewhere, which is
	 * the one the config opens from.
	 */
	hidden: boolean;
}) {
	const { chat } = useChat();
	const { sendMessage } = useMessaging();
	const { config, status, setConfig } = useConfig();
	const currentModal = useAppStore((state) => state.currentModal);

	const stream = useStreamStore((state) =>
		state.chatAgentStreams.get(chat.data?.id ?? ""),
	);

	const opened = useAppStore((state) => state.isConfigOpen && !hidden);
	const setConfigOpen = useAppStore((state) => state.setConfigOpen);
	const toggle = () => setConfigOpen(!opened);

	const isEmpty = useComposerStore((state) => state.isEmpty);
	const isIncomplete = useEditorStore((state) => state.isIncomplete);
	const { command, isRunning } = useShellCommand();

	const modelWidth = width * 0.25;

	useEffect(() => {
		const onClickOutside = (event: PointerEvent) => {
			if (!opened || currentModal) return;
			if (event.target instanceof HTMLElement) {
				const isRightSection = event.target.closest(".right-section");
				if (!isRightSection) {
					setConfigOpen(false);
				}
				event.preventDefault();
				event.stopPropagation();
			}
		};
		document.body.addEventListener("click", onClickOutside);
		return () => document.body.removeEventListener("click", onClickOutside);
	}, [currentModal, opened, setConfigOpen]);

	return (
		<>
			<TokenUsage usage={usage} categories={categories} />
			<Popover position="top" opened={opened}>
				<Popover.Target>
					{modelWidth < 100 ? (
						<ActionIcon
							variant="subtle"
							radius={25}
							h={30}
							w={30}
							disabled={disabled}
							color={
								status === "unavailable" ? "red" : "var(--mantine-color-dimmed)"
							}
							onClick={toggle}
							className="right-section"
						>
							<GearIcon size={20} />
						</ActionIcon>
					) : (
						<Button
							fw="normal"
							variant="subtle"
							radius={20}
							h={40}
							px={15}
							disabled={disabled}
							color={
								status === "unavailable" ? "red" : "var(--mantine-color-dimmed)"
							}
							onClick={toggle}
							className="right-section"
						>
							<Text size="sm" truncate="start" maw={modelWidth}>
								{status === "unavailable" ? "No model available" : config.model}
							</Text>
						</Button>
					)}
				</Popover.Target>
				<Popover.Dropdown maw={400} className="right-section">
					<ConfigPanel
						config={config}
						setConfig={setConfig}
						onMore={(capabilities) => AppService.openCapabilities(capabilities)}
						disabled={disabled}
						className="right-section"
					/>
				</Popover.Dropdown>
			</Popover>
			<ActionIcon
				variant="filled"
				size={40}
				radius={20}
				onClick={() => {
					if (command === null && chat.data && stream && isEmpty)
						AgentStreamService.abort(stream);
					else sendMessage.mutate();
				}}
				loading={sendMessage.isPending}
				disabled={
					command !== null
						? !command || isRunning || disabled
						: stream && isEmpty
							? false
							: isEmpty || isIncomplete || disabled || status !== "ready"
				}
			>
				{command !== null ? (
					<TerminalIcon size={20} />
				) : stream && isEmpty ? (
					<StopIcon size={20} />
				) : (
					<PaperPlaneTiltIcon size={20} />
				)}
			</ActionIcon>
		</>
	);
}
