import { type ReactNode, useState } from "react";
import type {
	CompletionGroup,
	CompletionItem,
} from "#client/features/editor/types/completion.ts";
import Completions from "#tui/core/components/Completions.tsx";
import Text from "#tui/core/components/Text.tsx";
import type { Bindings } from "#tui/core/utils/ListBindingUtils.ts";

export interface ChoiceItem extends CompletionItem {
	detail?: string;
}

/**
 * A submenu that picks one of its items — or toggles them, when `renderItem`
 * marks their state — and starts on the one already in effect. A setting that
 * can be unset lists that as an item of its own, such as "(default)".
 */
export default function Choice<T extends ChoiceItem>({
	groups,
	onSelect,
	selectName = "select",
	bindings,
	renderItem,
	before,
	tabs,
}: {
	groups: CompletionGroup<T>[];
	onSelect: (item: T) => void;
	/** What picking does, as the help puts it. */
	selectName?: string;
	/** The verbs besides picking. */
	bindings?: Omit<Bindings<T>, "primary">;
	renderItem?: (item: T) => ReactNode;
	before?: ReactNode;
	/** Narrows the choice to one of its named groups at a time with ←→. */
	tabs?: boolean;
}) {
	// The cursor starts on the item in effect, and is the user's after that.
	const [selected, setSelected] = useState(() =>
		Math.max(
			0,
			groups.flatMap((group) => group.items).findIndex((i) => i.active),
		),
	);

	return (
		<Completions<CompletionGroup<T>, T>
			groups={groups}
			selected={selected}
			setSelected={setSelected}
			selectFirstOnChange={false}
			before={before}
			tabs={tabs}
			bindings={{ ...bindings, primary: { name: selectName, run: onSelect } }}
			renderItem={({ item }) =>
				renderItem?.(item) ?? (
					<>
						<Text>{item.name}</Text>
						{item.detail && <Text color="textSubtle">{item.detail}</Text>}
					</>
				)
			}
			renderEmpty={() => "nothing to choose from"}
			actions={["back"]}
		/>
	);
}
