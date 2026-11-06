import { Group, Text } from "@mantine/core";
import { ChatCircleIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import SourceChip from "#gui/features/part/components/SourceChip.tsx";

export default function Quote({
	model,
	source,
	className,
	children,
	...props
}: ComponentProps<"blockquote"> & {
	model?: string;
	/** What it was quoted from, opened in the chat's sources on a click. */
	source?: string;
	children: ReactNode;
}) {
	return (
		<blockquote
			className={`my-4 border-muted-foreground/30 border-l-4 pl-4 text-muted-foreground italic ${className}`}
			data-streamdown="blockquote"
			{...props}
		>
			{model ? (
				<Group gap={5} c="dimmed" mb={4}>
					<ChatCircleIcon size={16} style={{ transform: "scale(-1,1)" }} />
					<Text size="xs">{model}</Text>
				</Group>
			) : (
				source && (
					<SourceChip path={source} size={16} c="dimmed" mb={4} gap={5}>
						<Text size="xs" fs="normal">
							{PathUtils.name(source)}
						</Text>
					</SourceChip>
				)
			)}
			{children}
		</blockquote>
	);
}
