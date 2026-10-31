import { type Key, useInput, useWindowSize } from "ink";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useCompletionStore } from "#client/features/editor/stores/useCompletionStore.ts";
import type {
	CompletionGroup,
	CompletionItem,
} from "#client/features/editor/types/completion.ts";
import { CompletionUtils } from "#client/features/editor/utils/CompletionUtils.ts";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import HelpText, { type Action } from "#tui/core/components/HelpText.tsx";
import { usePanel } from "#tui/core/components/Panel.tsx";
import ScrollView, {
	pageRows,
	type ScrollViewProps,
} from "#tui/core/components/ScrollView.tsx";
import Text from "#tui/core/components/Text.tsx";
import { useMouseInput } from "#tui/core/hooks/useMouseInput.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import {
	type Bindings,
	ListBindingUtils,
	type Verb,
} from "#tui/core/utils/ListBindingUtils.ts";

export type CompletionsProps<
	T1 extends CompletionGroup<T2>,
	T2 extends CompletionItem,
> = ScrollViewProps & {
	groups: T1[];
	selected?: number;
	setSelected?: (_: (previous?: number) => number) => void;
	itemRef?: RefObject<T2 | null>;
	/** Takes the keys, and draws its selection as such. Defaults to whether its panel is focused. */
	active?: boolean;
	/**
	 * The verbs its rows answer to, which take their keys and draw their help
	 * in the order every list shares. Prefer these to `onInput`.
	 */
	bindings?: Bindings<T2>;
	/**
	 * First look at every key, for what is not a verb (a draft taking the
	 * keys, say); `false` stops it there.
	 */
	onInput?: (_: {
		item?: T2;
		input: string;
		key: Key;
		/** The key was stood in for by a press on the item, not typed. */
		pointer?: boolean;
	}) => boolean | undefined;
	itemProps?: BoxProps;
	/**
	 * Pressing 1 to 9 selects the item in that place, leaving Enter to press
	 * it. Only for lists that are not also typed into.
	 */
	numbered?: boolean;
	renderItem?: (_: { item: T2; selected: boolean }) => ReactNode;
	renderEmpty?: () => ReactNode;
	withStyles?: boolean;
	before?: ReactNode;
	after?: ReactNode;
	/** Help for keys outside the verbs, drawn after theirs. */
	actions?: Action[];
	/** Draws the keys it takes below it. */
	help?: boolean;
	selectFirstOnChange?: boolean;
	stickToBottom?: number;
	/** Takes the full height it is given, as a sidebar does, instead of half the screen at most. */
	fill?: boolean;
	/**
	 * Narrows the list to one of its named groups at a time with ←→, every
	 * item being the first tab. `selected` stays an index into every item.
	 */
	tabs?: boolean;
};

export default function Completions<
	T1 extends CompletionGroup<T2>,
	T2 extends CompletionItem = CompletionItem,
>({
	groups,
	selected: controlledSelected,
	setSelected: setControlledSelected,
	itemRef,
	onInput,
	bindings,
	active: _active,
	itemProps,
	numbered = false,
	renderItem,
	renderEmpty,
	before,
	after,
	actions,
	help = true,
	selectFirstOnChange = true,
	stickToBottom,
	fill = false,
	tabs: withTabs = false,
	ref: _ref,
	...props
}: CompletionsProps<T1, T2>) {
	const { rows } = useWindowSize();
	const panel = usePanel();
	const active = _active ?? panel.focused;

	const items = groups.flatMap((group) =>
		group.items.map((item, position) => ({
			...item,
			group: group.name,
			groupLabel: position === 0 ? group.name : undefined,
		})),
	);

	// What is drawn is the tab's items; `selected` and everything handed back
	// out stay indices into every item, so a list's owner never sees the tab.
	const tabs = withTabs ? CompletionUtils.tabs(groups) : [];
	const [_tab, setTab] = useState<string | null>(null);
	const tab = tabs.includes(_tab) ? _tab : null;
	const indices = items.flatMap((item, index) =>
		tab === null || item.group === tab ? [index] : [],
	);

	const [uncontrolledSelected, setUncontrolledSelected] = useState(0);

	const selected = controlledSelected ?? uncontrolledSelected;
	const setSelected = setControlledSelected ?? setUncontrolledSelected;
	/** Where the selection is drawn among the tab's items. */
	const shown = Math.max(0, indices.indexOf(selected));

	const isEmpty = !items.length;
	useEffect(() => {
		if (!active) return;
		useCompletionStore.setState({
			isCompletionsOpen: true,
			isCompletionsEmpty: isEmpty,
		});
		return () => {
			useCompletionStore.setState({
				isCompletionsOpen: false,
				isCompletionsEmpty: true,
			});
		};
	}, [isEmpty, active]);

	const ownRef = useRef<NonNullable<ScrollViewProps["ref"]>["current"]>(null);
	const ref = _ref ?? ownRef;

	/**
	 * Moves the selection a page — the rows the view would scroll — and the
	 * view with it, stopping at either end rather than wrapping around.
	 */
	const pickPage = (direction: -1 | 1) => {
		const view = ref.current;
		const from = view?.getItemPosition(shown);
		if (!view || !from || !indices.length) return;
		const page = pageRows(view.getViewportHeight());
		let next = shown;
		for (
			let index = shown + direction;
			index >= 0 && index < indices.length;
			index += direction
		) {
			const position = view.getItemPosition(index);
			if (!position || Math.abs(position.top - from.top) > page) break;
			next = index;
		}
		// A row taller than a page is still a step.
		if (next === shown)
			next = Math.min(Math.max(shown + direction, 0), indices.length - 1);
		setSelected(() => indices[next] ?? 0);
	};

	const pick = (offset: number) => {
		if (!indices.length) return;
		const next = (shown + offset + indices.length) % indices.length;
		setSelected(() => indices[next] ?? 0);
	};

	/** Opens a tab, the selection going to its first item unless it is in it. */
	const selectTab = (next: string | null) => {
		setTab(next);
		const group = items[selected]?.group;
		if (next !== null && group !== next) {
			const first = items.findIndex((item) => item.group === next);
			if (first !== -1) setSelected(() => first);
		}
	};
	const pickTab = (direction: -1 | 1) =>
		selectTab(CompletionUtils.stepTab({ tabs, tab, direction }));

	const list = useId();
	const item = items[selected];
	const setArmed = useAppStore((state) => state.setArmed);
	const armed = useAppStore(
		(state) =>
			!!item && state.armed?.list === list && state.armed.value === item.value,
	);

	// An armed row is only ever in a list that has the keys.
	useEffect(() => {
		const disarm = () => {
			if (useAppStore.getState().armed?.list === list) setArmed(null);
		};
		if (!active) disarm();
		return disarm;
	}, [list, active, setArmed]);

	const perform = (verb: Verb | "cancel", direction?: -1 | 1) => {
		if (verb === "cancel") return setArmed(null);
		if (verb === "create") return bindings?.create?.run();
		if (verb === "refresh") return bindings?.refresh?.run(item);
		if (!item) return;
		if (verb === "remove") {
			if (!armed) return setArmed({ list, value: item.value });
			setArmed(null);
			return bindings?.remove?.run(item);
		}
		if (verb === "reorder") {
			if (!direction) return;
			bindings?.reorder?.run(item, direction);
			// The cursor follows the row it moved.
			const next = selected + direction;
			if (next >= 0 && next < items.length) setSelected(() => next);
			return;
		}
		bindings?.[verb]?.run(item);
	};

	const dispatch = (input: string, key: Key, pointer?: boolean) => {
		if (onInput?.({ item, input, key, pointer }) === false) return;
		const action =
			bindings &&
			ListBindingUtils.handle({ bindings, item, input, key, armed });
		if (action?.type === "arm" || action?.type === "confirm") {
			return perform("remove");
		}
		if (action?.type === "run") return perform(action.verb, action.direction);
		// Anything but a verb disarms, moving the cursor as it would anyway.
		if (action?.type === "disarm") setArmed(null);
		if (numbered && /^[1-9]$/.test(input) && !key.ctrl && !key.meta) {
			const index = indices[Number(input) - 1];
			if (index === undefined) return;
			setSelected(() => index);
			return;
		}
		if (key.shift) return;
		if (tabs.length && !key.ctrl && !key.meta && !key.super) {
			if (key.leftArrow) return pickTab(-1);
			if (key.rightArrow) return pickTab(1);
		}
		if (key.upArrow) pick(-1);
		if (key.downArrow) pick(1);
		if (key.pageUp) pickPage(-1);
		if (key.pageDown) pickPage(1);
	};

	useInput((input, key) => dispatch(input, key), { isActive: active });

	const [hovered, setHovered] = useState<number | null>(null);
	const { mouseRef } = useMouseInput({
		onClick: ({ index: position }) => {
			const index = position === undefined ? undefined : indices[position];
			if (index === undefined) return;
			// Only a press on what is already selected, in a list that already has
			// the focus, goes through: the first press on a list elsewhere just
			// focuses it (through its panel) and selects.
			if (active && selected === index) {
				dispatch("", { return: true } as Key, true);
			} else {
				// An armed row is only ever the selected one.
				if (armed) setArmed(null);
				setSelected(() => index);
			}
		},
		onHoverStart: ({ index }) => {
			setHovered(index);
		},
		onHoverEnd: ({ index }) => {
			if (hovered === index) setHovered(null);
		},
		isActive: !!items.length,
	});

	const tabMouse = useMouseInput({
		onClick: ({ index }) => {
			if (index !== undefined && index < tabs.length)
				selectTab(tabs[index] ?? null);
		},
		isActive: tabs.length > 0,
	});

	useEffect(() => {
		if (selectFirstOnChange && items.length) {
			setSelected(() => 0);
		}
	}, [setSelected, selectFirstOnChange, items.length]);

	useEffect(() => {
		if (!itemRef) return;
		itemRef.current = items[selected] ?? null;
	}, [selected, itemRef, items]);

	return (
		<Box
			padding={1}
			flexDirection="column"
			flexShrink={fill ? 1 : 0}
			flexGrow={fill ? 1 : 0}
			minHeight={fill ? 0 : undefined}
			backgroundColor="interior"
		>
			{before}
			{tabs.length > 0 && (
				<Box flexWrap="wrap" columnGap={2} marginBottom={1} marginLeft={2}>
					{tabs.map((name, index) => (
						<Box
							key={name ?? ""}
							ref={(element) => tabMouse.mouseRef(element, index)}
							flexShrink={0}
						>
							<Text
								color={name === tab ? "primary" : "textSubtle"}
								bold={name === tab}
								underline={name === tab}
							>
								{(name ?? "all").toLowerCase()}
							</Text>
						</Box>
					))}
				</Box>
			)}
			<ScrollView
				ref={ref}
				selectedIndex={shown}
				{...(fill
					? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }
					: { maxHeight: Math.floor(rows / 2) })}
				paddingBottom={1}
				{...props}
			>
				{indices.map((index, position) => {
					const item = items[index];
					if (!item) return null;
					const rendered =
						armed && index === selected ? (
							<Text color="redBright">
								{bindings?.remove?.label?.(item) ??
									`${bindings?.remove?.name ?? "delete"} "${item.name ?? item.value}"?`}
							</Text>
						) : (
							(renderItem?.({ item, selected: index === selected }) ??
							item.name)
						);
					// A tab is the group it shows, so it goes unlabelled.
					const label = tab === null ? item.groupLabel : undefined;
					return (
						<Box key={item.group + item.value} flexDirection="column">
							{label && (
								<Box marginLeft={2} marginTop={position > 0 ? 1 : 0}>
									<Text color="textSubtle" bold>
										{label.toLowerCase()}
									</Text>
								</Box>
							)}
							<Box
								ref={(element) => mouseRef(element, position)}
								color={
									index === selected
										? active
											? "primary"
											: "textSubtle"
										: undefined
								}
								dimColor={position === hovered || item.active}
							>
								<Text>{index === selected ? "▶ " : "  "}</Text>
								<Box gap={1} {...itemProps}>
									{typeof rendered === "string" ? (
										<Text>{rendered}</Text>
									) : (
										rendered
									)}
								</Box>
							</Box>
						</Box>
					);
				})}
				{items.length === 0 && renderEmpty && (
					<Text color="textSubtle">{renderEmpty()}</Text>
				)}
			</ScrollView>
			{after}
			{help && (
				<HelpText
					actions={[
						"move",
						...(tabs.length
							? [{ key: "←→", name: "group", onClick: () => pickTab(1) }]
							: []),
						...(bindings
							? ListBindingUtils.help(bindings, item, { armed }).map(
									({ verb, ...action }) => ({
										...action,
										// Shift+↑↓ has no one direction to stand in for.
										onClick:
											verb === "reorder" ? undefined : () => perform(verb),
									}),
								)
							: []),
						...(armed ? [] : (actions ?? [])),
					]}
				/>
			)}
		</Box>
	);
}
