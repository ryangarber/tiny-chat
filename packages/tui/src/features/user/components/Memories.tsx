import { useEffect, useState } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import { useMemories } from "#client/features/user/hooks/useMemories.ts";
import { Enum } from "#core/core/services/PostgresService.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import Text from "#tui/core/components/Text.tsx";
import { usePage } from "#tui/core/hooks/usePage.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { useAppStore } from "#tui/core/stores/useAppStore.ts";
import Choice from "#tui/features/settings/components/Choice.tsx";
import Details from "#tui/features/settings/components/Details.tsx";
import TextList, {
	type Draft,
} from "#tui/features/settings/components/TextList.tsx";

type Field = "category" | "stability";
type Route = "fact" | Field;

const VALUES = {
	category: Enum.MemoryCategory.values,
	stability: Enum.MemoryStability.values,
} as const;

const label = (value: string) => value.toLowerCase().replace("_", " ");

/** What the user is remembered by, written and corrected in place. */
export default function Memories() {
	const { memories, createMemory, updateMemory, deleteMemory } = useMemories();
	useWorkingStatus(memories, createMemory, updateMemory, deleteMemory);

	const items = memories.data ?? [];

	const [draft, setDraft] = useState<Draft | null>(null);
	// Looked up afresh so the editor shows a change as soon as it lands.
	// Opened on the one a source was edited from, if it was.
	const [editingId, setEditingId] = useState<string | null>(
		() => useLayoutStore.getState().record,
	);
	const clearRecord = useAppStore((state) => state.clearRecord);
	useEffect(() => clearRecord(), [clearRecord]);
	const editing = items.find((memory) => memory.id === editingId);
	const [route, setRoute] = useState<Route | null>(null);
	const [selected, setSelected] = useState(0);

	usePage({
		// A draft takes `back` first, then the field, then the memory.
		onBack: () => {
			if (draft) setDraft(null);
			else if (route) setRoute(null);
			else if (editing) setEditingId(null);
			else return;
			return false;
		},
	});

	if (editing && route === "fact") {
		return (
			<TextList
				entries={[{ label: "fact", text: editing.fact }]}
				draft={draft}
				setDraft={setDraft}
				placeholder="I prefer metric units."
				onEdit={(_, fact) => {
					if (fact) updateMemory.mutate({ memory: editing, fact });
				}}
			/>
		);
	}

	if (editing && route && route !== "fact") {
		const field = route;
		return (
			<Choice
				groups={[
					{
						name: field,
						items: VALUES[field].map((value) => ({
							name: label(value),
							value,
							active: editing[field] === value,
						})),
					},
				]}
				onSelect={(item) => {
					updateMemory.mutate({
						memory: editing,
						[field]: item.value as MemoryState[Field],
					});
					setRoute(null);
				}}
			/>
		);
	}

	if (editing) {
		return (
			<Details
				groups={[
					{
						items: [
							{
								name: "fact",
								value: "fact",
								state: editing.fact,
								route: "fact",
							},
							...(["category", "stability"] as const).map((field) => ({
								name: field,
								value: field,
								state: label(editing[field]),
								route: field,
							})),
						],
					},
				]}
				selected={selected}
				setSelected={setSelected}
				before={
					<Text color="textSubtle">
						{ChatSourcesUtils.memory(editing).learned}
					</Text>
				}
				onOpen={(next) => setRoute(next as Route)}
				remove={{
					name: "delete",
					label: "delete this memory?",
					run: () =>
						deleteMemory.mutate(
							{ id: editing.id },
							{ onSuccess: () => setEditingId(null) },
						),
				}}
			/>
		);
	}

	return (
		<TextList
			entries={items.map((memory) => ({
				text: memory.fact,
				detail: ChatSourcesUtils.memory(memory).details,
			}))}
			draft={draft}
			setDraft={setDraft}
			placeholder="I prefer metric units."
			onAdd={(fact) =>
				createMemory.mutate({
					fact,
					category: "PREFERENCES",
					stability: "LONG_TERM",
				})
			}
			onEdit={(index, fact) =>
				updateMemory.mutate({ memory: items[index], fact })
			}
			onRemove={(index) => deleteMemory.mutate({ id: items[index].id })}
			removeName="delete"
			onSelect={(index) => {
				setEditingId(items[index].id);
				setSelected(() => 0);
			}}
			selectName="open"
		/>
	);
}
