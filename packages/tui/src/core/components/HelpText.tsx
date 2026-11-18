import { Box, Text, useMouseInput } from "better-ink-ui";
import { useState } from "react";

export type Action =
	| {
			key: string;
			name: string;
			when?: boolean;
			/** Lets a press on the hint stand in for its key. */
			onClick?: () => void;
	  }
	| "move"
	| "select"
	| "back";

const expand = (action: Action) => {
	if (action === "move") return { key: "↑↓", name: "move" };
	if (action === "select") return { key: "enter", name: "select" };
	if (action === "back") return { key: "esc", name: "back" };
	return action;
};

/** The keys something takes, a press on one of them standing in for it. */
export default function HelpText({ actions: _actions }: { actions: Action[] }) {
	const active = _actions.map(expand).filter((action) => action.when ?? true);

	const [hovered, setHovered] = useState<number | null>(null);
	const { mouseRef } = useMouseInput({
		onClick: ({ index }) => active[index]?.onClick?.(),
		onHoverStart: ({ index }) => {
			if (active[index]?.onClick) setHovered(index);
		},
		onHoverEnd: ({ index }) => {
			setHovered((current) => (current === index ? null : current));
		},
	});

	return (
		<Box flexWrap="wrap">
			{active.map((action, index) => (
				<Box
					key={action.key + action.name}
					ref={(element) => mouseRef(element, index)}
					flexShrink={0}
				>
					<Text color="textSubtle" dimColor={hovered === index}>
						<Text bold>{action.key}</Text> {action.name}
						{index !== active.length - 1 && " · "}
					</Text>
				</Box>
			))}
		</Box>
	);
}
