import chalk from "chalk";
import type { ReactNode } from "react";
import type { CompletionGroup } from "#client/features/editor/types/completion.ts";
import Box from "#tui/core/components/Box.tsx";
import Text from "#tui/core/components/Text.tsx";
import Completions from "#tui/features/editor/components/Completions.tsx";

export interface DetailsItem {
	name: string;
	value: string;
	/** Drawn beside the name: the field's value, or how many it holds. */
	state?: string;
	/** Where Enter opens it. */
	route: string;
}

/** The row that removes the item itself, last in its own group. */
const REMOVE = "\0remove";
/** The row that saves the item's unsaved edits, ahead of the one that removes it. */
const SAVE = "\0save";

/**
 * One thing's details page — a project, a server, a memory — listing its
 * fields, each opened with Enter, and ending in a red row that removes it,
 * armed by Enter or `d` and put through by the same key again. A page whose
 * fields are kept as a draft, rather than saved one by one, adds a row that
 * saves them while there are edits to save.
 */
export default function Details({
	groups,
	selected,
	setSelected,
	onOpen,
	save,
	remove,
	refresh,
	before,
	after,
}: {
	groups: CompletionGroup<DetailsItem>[];
	selected: number;
	setSelected: (_: (previous?: number) => number) => void;
	onOpen: (route: string) => void;
	/** Left out while there is nothing to save. */
	save?: {
		/** What the row says beside `save`, such as `reconnects "github"`. */
		label?: string;
		run: () => void;
	};
	remove?: {
		name: "delete" | "remove";
		/** What the armed row asks, such as `delete "Notes" and its chats?`. */
		label: string;
		run: () => void;
	};
	refresh?: { run: () => void };
	before?: ReactNode;
	after?: ReactNode;
}) {
	return (
		<Completions<CompletionGroup<DetailsItem>, DetailsItem>
			groups={[
				...groups,
				...(save
					? [
							{
								items: [
									{ name: "save", value: SAVE, state: save.label, route: "" },
								],
							},
						]
					: []),
				...(remove
					? [{ items: [{ name: remove.name, value: REMOVE, route: "" }] }]
					: []),
			]}
			selected={selected}
			setSelected={setSelected}
			selectFirstOnChange={false}
			before={before}
			after={after}
			itemProps={{
				flexGrow: 1,
				flexShrink: 1,
				maxWidth: 50,
				justifyContent: "space-between",
			}}
			bindings={{
				primary: {
					name: (item) => (item.value === SAVE ? "save" : "open"),
					run: (item) => {
						if (item.value === SAVE) save?.run();
						else onOpen(item.route);
					},
					when: (item) => item.value !== REMOVE,
				},
				remove: remove && {
					name: remove.name,
					label: () => remove.label,
					run: remove.run,
					when: (item) => item.value === REMOVE,
					byEnter: true,
				},
				refresh,
			}}
			renderItem={({ item }) =>
				item.value === REMOVE ? (
					<Text color="redBright">{item.name}</Text>
				) : item.value === SAVE ? (
					<>
						<Box flexShrink={0} marginRight={2}>
							<Text color="primary">{item.name}</Text>
						</Box>
						{item.state && <Text color="textSubtle">{item.state}</Text>}
					</>
				) : (
					<>
						<Box flexShrink={0} marginRight={2}>
							<Text>{item.name}</Text>
						</Box>
						<Text color="text" wrap="truncate-start">
							{item.state ?? chalk.dim("(none)")}
						</Text>
					</>
				)
			}
			actions={["back"]}
		/>
	);
}
