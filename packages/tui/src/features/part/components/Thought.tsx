import { useAutoExpand } from "#client/features/part/hooks/useAutoExpand.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import Markdown from "#tui/features/message/components/Markdown.tsx";
import Tail from "#tui/features/part/components/Tail.tsx";
import Task from "#tui/features/part/components/Task.tsx";

/**
 * A run of thinking: open while it streams in, folded back to one line once
 * something follows it.
 */
export default function Thought({
	thoughts,
	hold,
}: {
	thoughts: Extract<RenderedPart, { type: "thought" }>[];
	/** Keeps it open after it settles, until something follows it. */
	hold?: boolean;
}) {
	const pending = thoughts.some((thought) => thought.active);

	const thoughtText = thoughts.map((thought) => thought.value).join("\n\n");

	const { expanded, auto, toggle } = useAutoExpand(
		thoughts[0]?.id ?? "",
		pending || !!hold,
	);

	return (
		<Task.Group>
			<Task expanded={expanded} onToggle={toggle}>
				<Task.Status
					status={pending ? "pending" : "success"}
					emoji="🧠"
					parts={[{ text: pending ? "Thinking" : "Thought" }]}
				/>
				<Task.Details>
					<Tail follow={auto}>
						<Markdown source={thoughtText} streaming={pending} />
					</Tail>
				</Task.Details>
			</Task>
		</Task.Group>
	);
}
