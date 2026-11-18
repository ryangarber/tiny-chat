import { Box, type SelectionMenu, SelectionMenuContext } from "better-ink-ui";
import { type ReactNode, useMemo } from "react";
import Button from "#tui/core/components/Button.tsx";

/** Something to do with what is selected, offered over it while it is. */
export interface SelectionAction {
	label: string;
	onSelect: (text: string) => void;
}

/**
 * Offers `actions` over any selection made inside — a model's reply offers to
 * quote it — as a bar of buttons. With none, a selection offers nothing, even
 * where an outer one would.
 */
export default function SelectionActions({
	actions,
	children,
}: {
	actions: SelectionAction[];
	children?: ReactNode;
}) {
	const menu = useMemo<SelectionMenu | null>(
		() =>
			actions.length === 0
				? null
				: ({ text, dismiss }) => (
						<Box paddingX={1} gap={1} backgroundColor="exterior">
							{actions.map((action) => (
								<Button
									key={action.label}
									label={action.label}
									onClick={() => {
										dismiss();
										if (text) action.onSelect(text);
									}}
								/>
							))}
						</Box>
					),
		[actions],
	);
	return <SelectionMenuContext value={menu}>{children}</SelectionMenuContext>;
}
