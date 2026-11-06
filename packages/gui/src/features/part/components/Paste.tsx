import { ClipboardTextIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
	useFindHidden,
	useFindRevealed,
} from "#client/features/find/hooks/useFindScope.ts";
import Task from "#gui/features/part/components/Task.tsx";

export default function Paste({
	lines,
	grabbable,
	children,
}: {
	lines?: string;
	grabbable?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	// Opened, too, while find shows a match somewhere in it.
	const revealed = useFindRevealed();
	const expanded = open || revealed;
	useFindHidden(!expanded);
	const label = lines ? `${lines} pasted lines` : "Pasted";

	return (
		<Task expanded={expanded} onToggle={() => setOpen(!expanded)} my={10}>
			<Task.Status
				icon={
					<ClipboardTextIcon
						size={20}
						color="var(--mantine-color-dimmed)"
						className="shrink-0"
					/>
				}
				status="success"
				parts={[{ text: label }]}
				style={grabbable ? { cursor: "grab" } : undefined}
			/>
			<Task.Details>{children}</Task.Details>
		</Task>
	);
}
