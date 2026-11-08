import {
	Box,
	type DefaultMantineColor,
	Group,
	Loader,
	Progress,
	RingProgress,
	Stack,
	Text,
} from "@mantine/core";
import type {
	Categories,
	CategoryId,
	Usage,
} from "#client/features/editor/hooks/useEstimatedTokens.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import Popup from "#gui/core/components/Popup.tsx";

/** Each category's color, shared by its section of the bar and its dot. */
const CATEGORY_COLORS: Record<CategoryId, DefaultMantineColor> = {
	instructions: "blue",
	memories: "grape",
	thoughts: "violet",
	tools: "orange",
	text: "teal",
	files: "pink",
};

export default function TokenUsage({
	usage,
	categories,
	disabled,
}: {
	usage: Usage<DefaultMantineColor>;
	categories: Categories;
	/** Keeps its breakdown shut, as while the config is open over it. */
	disabled?: boolean;
}) {
	return (
		<Popup position="top" disabled={disabled}>
			<Popup.Target>
				{usage.loading ? (
					<Loader size="xs" />
				) : (
					<RingProgress
						size={24}
						thickness={3}
						roundCaps
						sections={[
							{
								value: usage.percent,
								color: usage.color,
							},
						]}
					/>
				)}
			</Popup.Target>
			<Popup.Dropdown c="var(--mantine-color-text)" p="xs" w={220}>
				<Stack gap={8}>
					<Group justify="space-between" gap="xs" wrap="nowrap">
						<Text size="xs" fw={600}>
							Context
						</Text>
						<Text size="xs" c="dimmed">
							{usage.loading ? (
								<Loader size={10} />
							) : (
								<>
									{CommonUtils.formatCount(usage.tokens)}
									{usage.maxTokens !== undefined &&
										` / ${CommonUtils.formatCount(usage.maxTokens)} · ${Math.round(usage.percent)}%`}
								</>
							)}
						</Text>
					</Group>
					<Progress.Root size={6} radius="xl">
						{categories.map(
							(category) =>
								category.share > 0 && (
									<Progress.Section
										key={category.id}
										value={category.share * 100}
										color={CATEGORY_COLORS[category.id]}
									/>
								),
						)}
					</Progress.Root>
					<Stack gap={2}>
						{categories.map((category) => (
							<Group
								key={category.id}
								justify="space-between"
								gap="xs"
								wrap="nowrap"
							>
								<Group gap={6} wrap="nowrap">
									<Box
										w={6}
										h={6}
										bg={CATEGORY_COLORS[category.id]}
										style={{ borderRadius: "50%", flexShrink: 0 }}
									/>
									<Text size="xs">{category.name}</Text>
								</Group>
								<Text size="xs" c="dimmed" ff="monospace">
									{category.loading ? (
										<Loader size={10} />
									) : (
										CommonUtils.formatCount(category.tokens)
									)}
								</Text>
							</Group>
						))}
					</Stack>
				</Stack>
			</Popup.Dropdown>
		</Popup>
	);
}
