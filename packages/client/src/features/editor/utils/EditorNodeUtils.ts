import {
	type EditorPart,
	useEditorPartStore,
} from "#client/features/editor/stores/useEditorPartStore.ts";
import type { EditorNode } from "#client/features/editor/types/node.ts";
import { PasteUtils } from "#client/features/editor/utils/PasteUtils.ts";
import { CodeUtils } from "#core/core/utils/CodeUtils.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";

/**
 * What a paste turns into: a node folding it away when it is too long to
 * leave in an input, or a block of code — however the runtime writes one —
 * when it is short source.
 */
export type EditorPaste =
	| { type: "node"; node: EditorNode }
	| { type: "code"; text: string; language: string | null };

export const EditorNodeUtils = {
	/** Take a part into the registry and hand back the pointer standing for it. */
	create: (part: EditorPart): EditorNode => {
		useEditorPartStore.getState().addPart(part);
		return { type: part.type, id: part.id };
	},

	quote: ({
		model,
		source,
		text,
	}: {
		model?: string;
		source?: string;
		text: string;
	}): EditorNode =>
		EditorNodeUtils.create({
			id: CommonUtils.getRandomId(),
			type: "quote",
			...(model ? { model } : {}),
			...(source ? { source } : {}),
			text,
		}),

	command: ({
		name,
		value,
		argument,
	}: {
		name: string;
		value?: string;
		argument?: string;
	}): EditorNode =>
		EditorNodeUtils.create({
			id: CommonUtils.getRandomId(),
			type: "command",
			name,
			value,
			argument,
		}),

	/** Null means the runtime should leave the paste to its editor package. */
	paste: (text: string): EditorPaste | null => {
		const pasted = PasteUtils.normalize(text);
		if (!pasted) return null;

		const unwrapped = PasteUtils.unwrapFence(pasted.trim());
		const body = unwrapped?.text ?? pasted;
		const detected = PasteUtils.detectCode(body);
		const language =
			CodeUtils.getLanguage(unwrapped?.language ?? null) ??
			detected?.language ??
			null;

		if (PasteUtils.isLong(body)) {
			return {
				type: "node",
				node: EditorNodeUtils.create({
					id: CommonUtils.getRandomId(),
					type: "paste",
					text: body,
					lines: PasteUtils.lines(body).length,
					// Prose is only ever folded, never highlighted as code.
					language: unwrapped || detected ? language : null,
					collapsed: true,
				}),
			};
		}

		if (!unwrapped && !detected) return null;
		return { type: "code", text: body, language };
	},

	/** The part a node points at, or null once it has gone out of the registry. */
	part: (node: EditorNode) => {
		const part = useEditorPartStore.getState().parts[node.id];
		return part?.type === node.type ? part : null;
	},
} as const;
