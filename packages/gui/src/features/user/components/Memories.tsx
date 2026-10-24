import {
	ActionIcon,
	Group,
	Modal,
	Select,
	Stack,
	Text,
	Textarea,
} from "@mantine/core";
import { TrashIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { ChatSourcesUtils } from "#client/features/chat/utils/ChatSourcesUtils.ts";
import {
	type MemoryDraft,
	useMemories,
} from "#client/features/user/hooks/useMemories.ts";
import { Enum } from "#core/core/services/PostgresService.ts";
import type { MemoryState } from "#core/features/data/types/memory.ts";
import SaveButton from "#gui/core/components/SaveButton.tsx";
import VirtualList from "#gui/core/components/VirtualList.tsx";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import scrollable from "#gui/core/styles/scrollable.module.css";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import { StyleUtils } from "#gui/core/utils/StyleUtils.ts";

const options = (values: readonly string[]) =>
	values.map((value) => ({
		value,
		label: value.toLowerCase().replace("_", " "),
	}));

const CATEGORIES = options(Enum.MemoryCategory.values);
const STABILITIES = options(Enum.MemoryStability.values);

const getKey = (memory: MemoryState) => memory.id;

/** What the user is remembered by, written and corrected in place. */
export default function Memories() {
	const { memories, createMemory } = useMemories();

	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);
	const currentRecord = useLayoutStore((state) => state.record);
	const setRecord = useLayoutStore((state) => state.setRecord);
	const clearRecord = useCallback(() => setRecord(null), [setRecord]);

	const [category, setCategory] =
		useState<MemoryDraft["category"]>("PREFERENCES");
	const [stability, setStability] =
		useState<MemoryDraft["stability"]>("LONG_TERM");
	const [fact, setFact] = useState("");

	const create = () => {
		const next = fact.trim();
		if (!next) return;
		createMemory.mutate(
			{ fact: next, category, stability },
			{ onSuccess: () => setFact("") },
		);
	};

	return (
		<Modal
			opened={currentModal === "memories"}
			onClose={() => setCurrentModal(null)}
			title="Memories"
			size="lg"
			centered
			classNames={scrollable}
		>
			<Stack mih={0} flex="0 1 auto">
				<Stack gap="xs">
					<Textarea
						autosize
						maxRows={6}
						label="Memory"
						styles={{
							...StyleUtils.input,
							...{ input: { paddingTop: 25 } },
						}}
						placeholder="I prefer metric units."
						value={fact}
						onChange={(e) => setFact(e.target.value)}
						onKeyDown={ControlUtils.onEnter(create)}
						rightSection={
							<SaveButton
								label="Remember"
								dirty={!!fact.trim()}
								loading={createMemory.isPending}
								onClick={create}
							/>
						}
						disabled={createMemory.isPending}
						// Not over a memory being jumped to, which the keys go to instead.
						data-autofocus={!currentRecord || undefined}
					/>
					<Group grow>
						<Select
							size="xs"
							data={CATEGORIES}
							value={category}
							allowDeselect={false}
							onChange={(value) =>
								value && setCategory(value as MemoryDraft["category"])
							}
						/>
						<Select
							size="xs"
							data={STABILITIES}
							value={stability}
							allowDeselect={false}
							onChange={(value) =>
								value && setStability(value as MemoryDraft["stability"])
							}
						/>
					</Group>
				</Stack>
				{memories.data?.length === 0 && (
					<Text size="sm" c="dimmed" ta="center">
						Nothing remembered yet
					</Text>
				)}
				<VirtualList
					items={memories.data ?? []}
					getKey={getKey}
					gap={16}
					renderItem={(memory) => (
						<Memory key={`${memory.id}:${memory.fact}`} memory={memory} />
					)}
					focused={currentRecord}
					onFocused={clearRecord}
				/>
			</Stack>
		</Modal>
	);
}

function Memory({ memory }: { memory: MemoryState }) {
	// Its own mutations, so only this memory waits on them.
	const { updateMemory, deleteMemory } = useMemories();
	const updating = updateMemory.isPending;
	const deleting = deleteMemory.isPending;

	const [draft, setDraft] = useState(memory.fact);
	const dirty = draft.trim() !== memory.fact;
	const save = () => {
		const fact = draft.trim();
		if (fact === memory.fact) return;
		if (fact) updateMemory.mutate({ memory, fact });
		else deleteMemory.mutate({ id: memory.id });
	};

	return (
		<Stack gap={4}>
			<Textarea
				value={draft}
				autosize
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={ControlUtils.onEnter(save)}
				rightSectionWidth={dirty || updating ? 64 : undefined}
				rightSection={
					<Group gap={0} wrap="nowrap">
						<SaveButton
							dirty={dirty}
							loading={updating}
							disabled={deleting}
							onClick={save}
						/>
						<ActionIcon
							variant="subtle"
							aria-label="Delete memory"
							onClick={() => deleteMemory.mutate({ id: memory.id })}
							disabled={deleting}
						>
							<TrashIcon size={20} />
						</ActionIcon>
					</Group>
				}
				disabled={updating || deleting}
			/>
			<Group gap="xs" wrap="nowrap">
				<Select
					size="xs"
					variant="filled"
					data={CATEGORIES}
					value={memory.category}
					allowDeselect={false}
					onChange={(value) =>
						value &&
						updateMemory.mutate({
							memory,
							category: value as MemoryState["category"],
						})
					}
					disabled={updating || deleting}
				/>
				<Select
					size="xs"
					variant="filled"
					data={STABILITIES}
					value={memory.stability}
					allowDeselect={false}
					onChange={(value) =>
						value &&
						updateMemory.mutate({
							memory,
							stability: value as MemoryState["stability"],
						})
					}
					disabled={updating || deleting}
				/>
				<Text size="xs" c="dimmed" ml="auto" style={{ whiteSpace: "nowrap" }}>
					{ChatSourcesUtils.memory(memory).learned}
				</Text>
			</Group>
		</Stack>
	);
}
