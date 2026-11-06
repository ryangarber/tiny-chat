import { Loader, Tooltip } from "@mantine/core";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import SourceChip from "#gui/features/part/components/SourceChip.tsx";

export default function Attachment({
	source,
	directory,
	name,
	grabbable,
	pending,
	error,
}: {
	source: string;
	directory?: boolean;
	/** Stands in for the path when it says nothing, as an upload's id does. */
	name?: string;
	grabbable?: boolean;
	/** Still being read; the message waits on it to be sent. */
	pending?: boolean;
	/** Why it could not be read; sent as unavailable. */
	error?: string;
}) {
	const chip = (
		<span
			className={`inline-flex items-center gap-1 text-sm! font-medium rounded-xl px-2 bg-(--mantine-color-default-hover) ${grabbable ? "cursor-grab" : "cursor-default"}`}
			style={{
				opacity: pending ? 0.7 : undefined,
				transition: "opacity 150ms ease",
			}}
			aria-busy={pending || undefined}
		>
			<SourceChip path={source} directory={directory} inline className="py-1">
				{name ?? PathUtils.name(source)}
				{directory ? "/" : ""}
			</SourceChip>
			{pending ? (
				<Loader size={12} color="var(--mantine-color-dimmed)" ml={2} />
			) : error ? (
				<WarningCircleIcon
					size={16}
					weight="fill"
					color="var(--mantine-color-red-filled)"
					aria-label="Could not be read"
				/>
			) : null}
		</span>
	);

	if (pending) {
		return (
			<Tooltip label="Attaching…" openDelay={300}>
				{chip}
			</Tooltip>
		);
	}
	if (error) {
		return (
			<Tooltip
				label={`Unavailable: ${error}`}
				multiline
				maw={360}
				openDelay={150}
			>
				{chip}
			</Tooltip>
		);
	}
	return chip;
}
