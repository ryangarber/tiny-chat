import type { ReactNode } from "react";

export default function Command({
	name,
	content,
}: {
	name: string;
	content?: ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-1 rounded-xl bg-muted cursor-default">
			<span className="px-2 py-1 text-sm! font-medium" contentEditable={false}>
				/{name}
			</span>
			{content && (
				<span className="rounded-xl px-2 py-1 text-sm bg-(--tc-surface) border border-(--tc-interior) min-w-1 min-h-7">
					{content}
				</span>
			)}
		</span>
	);
}
