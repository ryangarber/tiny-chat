import { Box, Collapse, Group, Text } from "@mantine/core";
import { ClipboardTextIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";

export default function Paste({
	lines,
	grabbable,
	children,
}: {
	lines?: string;
	grabbable?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	// Opened, too, while find shows a match somewhere in it.
	const revealed = useFindRevealed();
	const expanded = open || revealed;
	useFindHidden(!expanded);
	const label = lines ? `${lines} pasted lines` : "Pasted";

	return (
		<Box my={10}>
			<Group
				onClick={() => {
					setOpen(!expanded);
				}}
				style={{ cursor: grabbable ? "grab" : "pointer" }}
				gap="xs"
				wrap="nowrap"
			>
				<ClipboardTextIcon size={24} color="var(--mantine-color-dimmed)" />
				<Text truncate="end">{label}</Text>
			</Group>
			<Collapse expanded={expanded}>
				{expanded && (
					<Box
						style={{
							borderLeft: "2px solid var(--mantine-color-default-border)",
						}}
						px="lg"
						py="xs"
						ml={8}
					>
						{children}
					</Box>
				)}
			</Collapse>
		</Box>
	);
}
