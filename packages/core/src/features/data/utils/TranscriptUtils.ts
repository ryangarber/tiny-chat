import type { MessageState } from "#core/features/data/types/message.ts";
import type { zDataPart } from "#core/features/data/types/part.ts";
import { EditorPartUtils } from "#core/features/data/utils/EditorPartUtils.ts";

/** Roughly 25k tokens: enough for a long chat without crowding out the one it is attached to. */
const MAX_CHARS = 100_000;

/** A paste or quote is the user's own material, but rarely needed whole to follow along. */
const MAX_BLOCK_CHARS = 2_000;

/** What a tool was called with, enough to tell what it was doing. */
const MAX_INPUT_CHARS = 200;

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max)}…` : text;

export const TranscriptUtils = {
	/**
	 * A chat as a reader would follow it, for asking about it from another one:
	 * what each side said, what the user attached, and what the model did, in
	 * a line per tool call. Thinking and tool output are left out — the replies
	 * already say what came of them — and a chat past the budget keeps its
	 * opening message and as much of its end as fits.
	 */
	build: ({
		title,
		messages,
		maxChars = MAX_CHARS,
	}: {
		title?: string | null;
		messages: Pick<MessageState, "author" | "createdAt" | "data">[];
		maxChars?: number;
	}): string => {
		const blocks = messages
			.map((message) => {
				const body = message.data
					.flat()
					.flatMap((part) => TranscriptUtils.part(part))
					.join("\n\n")
					.trim();
				if (!body) return null;

				const author = message.author === "USER" ? "User" : "Assistant";
				const at = message.createdAt.toString().slice(0, 16).replace("T", " ");
				return `## ${author} (${at} UTC)\n\n${body}`;
			})
			.filter((block) => block !== null);

		const header = `# ${title || "Untitled chat"}`;
		const [first, ...rest] = blocks;
		if (!first) return `${header}\n\n(no messages)`;

		let size = header.length + first.length;
		const tail: string[] = [];
		for (let i = rest.length - 1; i >= 0; i--) {
			if (size + rest[i].length > maxChars) break;
			size += rest[i].length;
			tail.unshift(rest[i]);
		}

		const omitted = rest.length - tail.length;
		return [
			header,
			first,
			...(omitted
				? [`(${omitted} message${omitted === 1 ? "" : "s"} omitted for length)`]
				: []),
			...tail,
		].join("\n\n");
	},

	/** One part as transcript text, or nothing where it adds nothing to follow. */
	part: (part: zDataPart): string[] => {
		switch (part.type) {
			case "text":
				return part.value.trim() ? [part.value.trim()] : [];
			case "attachment":
			case "command":
				return [EditorPartUtils.toText(part)];
			case "quote":
			case "paste":
				return [
					EditorPartUtils.toText({
						...part,
						text: clip(part.text, MAX_BLOCK_CHARS),
					}),
				];
			case "file":
				return [`[file${part.name ? `: ${part.name}` : ""}]`];
			case "toolCall": {
				const input = JSON.stringify(part.input ?? {});
				return [`[${part.name} ${clip(input, MAX_INPUT_CHARS)}]`];
			}
			case "toolResult":
				return part.error ? [`[${part.name} failed]`] : [];
			case "interjection":
				return part.value.flatMap((value) => TranscriptUtils.part(value));
			case "abort":
				return [`[stopped: ${part.reason}]`];
			default:
				return [];
		}
	},
} as const;
