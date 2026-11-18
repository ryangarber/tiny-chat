import { Box, Text, useMouseInput } from "better-ink-ui";
import { useState } from "react";
import type { Usage } from "#client/features/editor/hooks/useEstimatedTokens.ts";
import Button from "#tui/core/components/Button.tsx";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import type { Color } from "#tui/core/utils/ColorTypes.ts";
import TokenUsage from "#tui/features/editor/components/TokenUsage.tsx";

const Separator = () => <Text color="textSubtle"> · </Text>;

/**
 * The composer's bottom row, as the app's right section: the token pie, which
 * shows the breakdown while hovered; the model, which opens `/config`; and
 * send, or stop while a reply streams.
 */
export default function EditorFooter({
	usage,
	onTokensOpenChange,
	model,
	unavailable,
	maxModelWidth,
	canSend,
	onSend,
	onStop,
}: {
	usage: Usage<Color>;
	onTokensOpenChange: (open: boolean) => void;
	model: string | undefined;
	unavailable: boolean;
	maxModelWidth: number;
	canSend: boolean;
	onSend: () => void;
	/** Stands in for send while a reply streams and nothing is written. */
	onStop?: () => void;
}) {
	const setFocus = useAppStore((state) => state.setFocus);

	const [hovered, setHovered] = useState(false);
	const { mouseRef } = useMouseInput({
		onHoverStart: () => setHovered(true),
		onHoverEnd: () => setHovered(false),
		onClick: () => setFocus("config"),
	});

	return (
		<Box justifyContent="flex-end" flexShrink={0}>
			<TokenUsage usage={usage} onOpenChange={onTokensOpenChange} />
			<Separator />
			<Box ref={(element) => mouseRef(element, 0)} minWidth={0}>
				<Text
					color={unavailable ? "redBright" : "textSubtle"}
					dimColor={hovered}
					wrap="truncate-start"
				>
					{!model
						? "config"
						: model.length > maxModelWidth
							? `…${model.slice(1 - maxModelWidth)}`
							: model}
				</Text>
			</Box>
			<Separator />
			{onStop ? (
				<Button label="stop" onClick={onStop} />
			) : (
				<Button label="send" disabled={!canSend} onClick={onSend} />
			)}
		</Box>
	);
}
