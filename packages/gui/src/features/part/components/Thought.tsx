import { BrainIcon } from "@phosphor-icons/react";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import { useAutoExpand } from "#client/features/part/hooks/useAutoExpand.ts";
import type { RenderedPart } from "#core/features/data/utils/DataUtils.ts";
import Markdown from "#gui/features/message/components/Markdown.tsx";
import Tail from "#gui/features/part/components/Tail.tsx";
import Task from "#gui/features/part/components/Task.tsx";

/** Height the thought is held to while it is open on its own. */
const TAIL_HEIGHT = 400;

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
		useFindRevealed(),
	);
	useFindHidden(!expanded);

	return (
		<Task.Group>
			<Task expanded={expanded} onToggle={toggle} my={10}>
				<Task.Status
					icon={
						<BrainIcon
							size={20}
							color="var(--mantine-color-dimmed)"
							className="shrink-0"
						/>
					}
					status={pending ? "pending" : "success"}
					parts={[{ text: pending ? "Thinking..." : "Thought" }]}
				/>
				<Task.Details pr="lg">
					<Tail follow={auto} height={TAIL_HEIGHT} content={thoughtText}>
						<div style={{ zoom: 0.9 }}>
							<Markdown source={thoughtText} streaming={pending} />
						</div>
					</Tail>
				</Task.Details>
			</Task>
		</Task.Group>
	);
}
