import { NavLink, Stack, Text } from "@mantine/core";
import type {
	GetStartedBlock as GetStartedBlockType,
	GetStartedTarget,
} from "#client/features/chat/types/getStarted.ts";

/**
 * Draws one piece of a get-started widget. Each widget describes itself in
 * these blocks, so a new one needs no code here.
 */
export default function GetStartedBlock({
	block,
	onOpen,
}: {
	block: GetStartedBlockType;
	onOpen: (target: GetStartedTarget) => void;
}) {
	switch (block.type) {
		case "links":
			return (
				<Stack gap={0}>
					{block.links.map((link) => (
						<NavLink
							key={
								link.target.type === "chat"
									? link.target.id
									: link.target.project.id
							}
							component="a"
							href={
								link.target.type === "chat" ? `/#/${link.target.id}` : undefined
							}
							label={link.label}
							h={40}
							styles={{
								label: { overflow: "hidden", textOverflow: "ellipsis" },
							}}
							rightSection={
								link.description && (
									<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
										{link.description}
									</Text>
								)
							}
							onClick={(event) => {
								event.preventDefault();
								onOpen(link.target);
							}}
						/>
					))}
				</Stack>
			);
	}
}
