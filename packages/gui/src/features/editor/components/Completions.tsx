import {
	Badge,
	Box,
	Combobox,
	Group,
	Paper,
	ScrollAreaAutosize,
	Text,
	useCombobox,
} from "@mantine/core";
import { type Editor, type Range, ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import {
	forwardRef,
	type ReactNode,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useState,
} from "react";
import { useCompletionStore } from "#client/features/editor/stores/useCompletionStore.ts";
import type {
	CompletionGroup,
	CompletionItem,
} from "#client/features/editor/types/completion.ts";
import { CompletionUtils } from "#client/features/editor/utils/CompletionUtils.ts";

export type { CompletionGroup, CompletionItem };

export type SuggestionRenderer<T1, T2> = ReturnType<
	NonNullable<SuggestionOptions<T1, T2>["render"]>
>;

export interface CompletionProps<
	T1 extends CompletionGroup<T2>,
	T2 extends CompletionItem,
> extends SuggestionProps<T1, T2> {
	renderEmpty: () => ReactNode;
	renderItem?: (item: T2) => ReactNode;
	/** Narrows the list to one of its named groups at a time with ←→. */
	tabs?: boolean;
	onTab?: (args: {
		item: T2;
		editor: Editor;
		range: Range;
		query: string;
		select: () => void;
	}) => boolean | undefined;
}

function Completions<
	T1 extends CompletionGroup<T2>,
	T2 extends CompletionItem,
>() {
	return forwardRef<SuggestionRenderer<T1, T2>, CompletionProps<T1, T2>>(
		(
			{
				items: _groups,
				command,
				editor,
				range,
				query,
				renderEmpty,
				renderItem,
				tabs: withTabs,
				onTab,
			},
			ref,
		) => {
			const combobox = useCombobox();

			const tabs = useMemo(
				() => (withTabs ? CompletionUtils.tabs(_groups) : []),
				[withTabs, _groups],
			);
			const [_tab, setTab] = useState<string | null>(null);
			const tab = tabs.includes(_tab) ? _tab : null;

			const [groups, items] = useMemo(() => {
				const shown = CompletionUtils.inTab({ groups: _groups, tab });
				return [
					shown.filter((group) => group.items.length),
					shown.flatMap((group) => group.items),
				];
			}, [_groups, tab]);

			const select = useCallback(
				(value: string) => {
					const item = items.find((item) => item.value === value);
					if (item) command(item);
				},
				[items, command],
			);

			useImperativeHandle(
				ref,
				() => ({
					onKeyDown: ({ event }) => {
						const modified =
							event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
						if (
							tabs.length &&
							!modified &&
							(event.key === "ArrowLeft" || event.key === "ArrowRight")
						) {
							setTab(
								CompletionUtils.stepTab({
									tabs,
									tab,
									direction: event.key === "ArrowLeft" ? -1 : 1,
								}),
							);
							return true;
						}
						if (event.key === "ArrowDown") {
							combobox.selectNextOption();
							return true;
						}
						if (event.key === "ArrowUp") {
							combobox.selectPreviousOption();
							return true;
						}
						if (event.key === "Enter") {
							combobox.clickSelectedOption();
							return true;
						}
						if (event.key === "Tab") {
							const item = items[combobox.getSelectedOptionIndex()];
							if (!item) return true;

							if (onTab) {
								const handled = onTab({
									item,
									editor,
									range,
									query,
									select: () => select(item.value),
								});
								if (handled !== false) return true;
							}

							select(item.value);
							return true;
						}
						return false;
					},
				}),
				[combobox, editor, items, onTab, query, range, select, tabs, tab],
			);

			// biome-ignore lint/correctness/useExhaustiveDependencies: auto select
			useEffect(() => {
				combobox.selectFirstOption();
			}, [groups, combobox.selectFirstOption]);

			const isEmpty = groups.length === 0;
			useEffect(() => {
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
			}, [isEmpty]);

			return (
				<Combobox store={combobox} onOptionSubmit={select} withinPortal={false}>
					<Paper withBorder>
						{tabs.length > 0 && (
							<Group
								gap={4}
								px={5}
								pt={5}
								wrap="nowrap"
								w={250}
								style={{ overflowX: "auto" }}
								// Clicking a tab keeps the cursor in the editor.
								onMouseDown={(event) => event.preventDefault()}
							>
								{tabs.map((name) => (
									<Badge
										key={name ?? ""}
										size="sm"
										radius="sm"
										variant={name === tab ? "filled" : "light"}
										color={name === tab ? undefined : "gray"}
										style={{ cursor: "pointer", flexShrink: 0 }}
										onClick={() => setTab(name)}
									>
										{name ?? "All"}
									</Badge>
								))}
							</Group>
						)}
						<Combobox.Options>
							<ScrollAreaAutosize mah={300} w={250} p={5}>
								<Box>
									{groups.length === 0 && (
										<Text size="sm" p="xs">
											{renderEmpty()}
										</Text>
									)}
									{groups.map((group) => (
										<Combobox.Group
											key={group.items.map((item) => item.value).join(",")}
											// A tab is the group it shows, so it goes unlabelled.
											label={tab === null ? group.name : undefined}
										>
											{group.items.map((item) => (
												<Combobox.Option
													key={item.value}
													value={item.value}
													disabled={item.active}
												>
													<Group
														gap={5}
														miw={0}
														wrap="nowrap"
														align="flex-start"
														style={{
															overflow: "hidden",
															whiteSpace: "nowrap",
															textOverflow: "ellipsis",
														}}
													>
														{renderItem ? renderItem(item) : item.name}
													</Group>
												</Combobox.Option>
											))}
										</Combobox.Group>
									))}
								</Box>
							</ScrollAreaAutosize>
						</Combobox.Options>
					</Paper>
				</Combobox>
			);
		},
	);
}

export function renderCompletions<
	T1 extends CompletionGroup<T2>,
	T2 extends CompletionItem,
>(
	props: Omit<CompletionProps<T1, T2>, keyof SuggestionProps<T1, T2>>,
): () => SuggestionRenderer<T1, T2> {
	let instance: ReactRenderer<
		SuggestionRenderer<T1, T2>,
		CompletionProps<T1, T2>
	> | null = null;
	let unmount: (() => void) | null = null;

	return () => ({
		onStart: (baseProps) => {
			instance = new ReactRenderer<
				SuggestionRenderer<T1, T2>,
				CompletionProps<T1, T2>
			>(Completions<T1, T2>(), {
				props: {
					...baseProps,
					...props,
				},
				editor: baseProps.editor,
			});
			unmount = baseProps.mount(instance.element);
		},
		onUpdate: (props) => {
			instance?.updateProps(props);
		},
		onKeyDown: (props) => instance?.ref?.onKeyDown?.(props) ?? false,
		onExit: () => {
			unmount?.();
			instance?.destroy();
			instance = null;
			unmount = null;
		},
	});
}
