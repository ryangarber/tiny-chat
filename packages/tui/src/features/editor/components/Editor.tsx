import { type Key, useInput } from "ink";
import { useContext, useEffect, useMemo, useRef } from "react";
import { ClientContext } from "#client/client.ts";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";
import { useConfig } from "#client/features/agent/hooks/useConfig.ts";
import { useMessaging } from "#client/features/chat/hooks/useMessaging.ts";
import { useChatStore } from "#client/features/chat/stores/useChatStore.ts";
import { useDisabled } from "#client/features/editor/hooks/useDisabled.ts";
import type {
	Categories,
	Usage,
} from "#client/features/editor/hooks/useEstimatedTokens.ts";
import { AttachmentService } from "#client/features/editor/services/AttachmentService.ts";
import { ComposerService } from "#client/features/editor/services/ComposerService.ts";
import { useAtomStore } from "#client/features/editor/stores/useAtomStore.ts";
import { useCompletionStore } from "#client/features/editor/stores/useCompletionStore.ts";
import { AtomUtils } from "#client/features/editor/utils/AtomUtils.ts";
import { EditorNodeUtils } from "#client/features/editor/utils/EditorNodeUtils.ts";
import { PasteUtils } from "#client/features/editor/utils/PasteUtils.ts";
import { useMessages } from "#client/features/message/hooks/useMessages.ts";
import { useMessageStore } from "#client/features/message/stores/useMessageStore.ts";
import { useUploads } from "#client/features/upload/hooks/useUploads.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";
import Box from "#tui/core/components/Box.tsx";
import Panel from "#tui/core/components/Panel.tsx";
import type { Color } from "#tui/core/hooks/useColor.ts";
import { useWidth } from "#tui/core/hooks/useWidth.ts";
import { useWorkingStatus } from "#tui/core/hooks/useWorkingStatus.ts";
import { ClipboardService } from "#tui/core/services/ClipboardService.ts";
import { selectFocus, useAppStore } from "#tui/core/stores/useAppStore.ts";
import Attachments from "#tui/features/editor/components/Attachments.tsx";
import Commands from "#tui/features/editor/components/Commands.tsx";
import Shell from "#tui/features/editor/components/Shell.tsx";
import TokenUsage from "#tui/features/editor/components/TokenUsage.tsx";
import { useCodeHighlight } from "#tui/features/editor/hooks/useCodeHighlight.ts";
import { useEditorStore } from "#tui/features/editor/stores/useEditorStore.ts";
import { EditorUtils } from "#tui/features/editor/utils/EditorUtils.ts";
import { FilePasteUtils } from "#tui/features/editor/utils/FilePasteUtils.ts";
import {
	MarkdownUtils,
	type MarkdownWrite,
} from "#tui/features/editor/utils/MarkdownUtils.ts";
import Textarea from "#tui/features/textarea/components/Textarea.tsx";
import { TextareaUtils } from "#tui/features/textarea/utils/TextareaUtils.ts";

export default function Editor({
	disabled: _disabled,
	usage,
	categories,
}: {
	disabled: boolean;
	usage: Usage<Color>;
	categories: Categories;
}) {
	const client = useContext(ClientContext);

	const { colorScheme } = useContext(ThemeContext);
	const columns = useWidth();

	const focus = useAppStore(selectFocus);
	const cycleFocus = useAppStore((state) => state.cycleFocus);
	const nextFeedbackId = useMessageStore((s) => s.nextFeedbackId);
	const { disabled } = useDisabled({
		disabled: _disabled || focus !== "editor",
	});
	// Feedback that turns up, live or by opening a chat that has some waiting,
	// takes the focus from the editor so it can be answered right away — but
	// not from a page or a panel the reader is busy in.
	const previousFeedbackId = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (nextFeedbackId && nextFeedbackId !== previousFeedbackId.current) {
			const { setFocus } = useAppStore.getState();
			const current = selectFocus(useAppStore.getState());
			if (current === "editor" || current.startsWith("tool:"))
				setFocus(`tool:${nextFeedbackId}`);
		}
		previousFeedbackId.current = nextFeedbackId;
	}, [nextFeedbackId]);
	const { config, status, modelArgs } = useConfig();
	const { sendMessage } = useMessaging();
	const { messages } = useMessages();
	const { upload } = useUploads();
	useWorkingStatus(messages, sendMessage, upload);

	const content = useEditorStore((state) => state.content);
	const setContent = useEditorStore((state) => state.setContent);

	// The commands, the attachments and the pastes standing in the value, each
	// of which is drawn, stepped over and taken out whole.
	const atoms = useAtomStore((state) => state.atoms);

	const cursor = useEditorStore((state) => state.cursor);
	const setCursor = useEditorStore((state) => state.setCursor);
	const insertAt = useEditorStore((state) => state.insert);

	const unfold = useEditorStore((state) => state.unfold);
	const refold = useEditorStore((state) => state.refold);

	// A paste clicked open is folded back up once the cursor leaves it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-checked on every move and edit
	useEffect(() => {
		refold();
	}, [content, cursor, refold]);

	const selection = useEditorStore((state) => state.selection);
	const setSelection = useEditorStore((state) => state.setSelection);

	const isCompletionsOpen = useCompletionStore(
		(state) => state.isCompletionsOpen,
	);
	const isCompletionsEmpty = useCompletionStore(
		(state) => state.isCompletionsEmpty,
	);

	const project = useChatStore((state) => state.active.project);
	const placeholder = useMemo(() => {
		if (!config) return project ? project.title || "untitled" : "(none)";
		return [
			project ? project.title || "untitled" : "(none)",
			status === "unavailable" ? "no model available" : config.model,
			...modelArgs.map(
				(arg) => `${arg.name} ${config.args?.[arg.name] ?? arg.default}`,
			),
		]
			.join(" · ")
			.slice(0, columns - 12);
	}, [config, status, modelArgs, columns, project]);

	// The atoms are painted before the markdown, so a command or an attachment
	// standing in the value keeps its own style whatever punctuation it carries.
	const highlight = useCodeHighlight(content);
	const labels = useMemo(
		() => [
			...EditorUtils.tokenLabels({ atoms }),
			...MarkdownUtils.labels({ highlight }),
		],
		[atoms, highlight],
	);

	const styles = useMemo(
		() => ({
			...MarkdownUtils.styles(colorScheme),
			command: { color: colorScheme.primary, bold: true },
			attachment: { color: colorScheme.primary, bold: true },
			paste: { color: colorScheme.textSubtle, bold: true },
		}),
		[colorScheme],
	);

	// The content and its atoms are what the editor holds, but the message
	// being written is what every other reader wants — so it is kept in step
	// here, the way the app keeps its own editor's `zData` in step on update.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read on every change to what the editor holds
	useEffect(() => {
		ComposerService.getData({ client });
	}, [content, atoms]);

	const offset = TextareaUtils.offset(content, cursor);

	// The range Alt takes out, which stops against an atom rather than cutting a
	// word out of the middle of one.
	const backwardWord = EditorUtils.wordDeletion({
		value: content,
		atoms,
		offset,
		direction: -1,
	});
	const forwardWord = EditorUtils.wordDeletion({
		value: content,
		atoms,
		offset,
		direction: 1,
	});

	const remove = ([start, end]: [start: number, end: number]) => {
		setContent(content.slice(0, start) + content.slice(end));
		setCursor(TextareaUtils.cursor(content, start));
	};

	/** Writes content in whole, with the cursor left where the write leaves it. */
	const write = ({ content: next, offset: to }: MarkdownWrite) => {
		setContent(next);
		setCursor(TextareaUtils.cursor(next, to));
	};

	// A markdown marker closes itself as it is opened, which the text area knows
	// nothing of: it writes the one character it was handed, and the write that
	// should have been made in its place is put in here instead.
	const handleChange = (next: string) => {
		const isTyped =
			!selection &&
			next.length === content.length + 1 &&
			next.slice(0, offset) === content.slice(0, offset) &&
			next.slice(offset + 1) === content.slice(offset);

		const marked = isTyped
			? MarkdownUtils.marked({ value: content, offset, marker: next[offset] })
			: null;

		if (marked) write(marked);
		else setContent(next);
	};

	/** Writes text in at the cursor, over whatever is selected. */
	const insert = (text: string) => {
		insertAt(text, selection ? TextareaUtils.range(selection) : undefined);
		setSelection(null);
	};

	// A paste arrives whole rather than a key at a time, which is what lets a
	// long one be collapsed into an atom instead of filling the editor with it.
	// Terminals send their newlines as carriage returns, which the value holds
	// as line feeds. It is taken from the text area, which would otherwise
	// insert it as it stands.
	const paste = (text: string) => {
		const pasted = text.replace(/\r\n?/g, "\n");
		if (!pasted) return;

		// A file dragged onto a macOS terminal arrives as its escaped path
		// rather than its contents, so it is attached instead of dumped in as
		// text.
		const files = FilePasteUtils.detect(pasted);
		if (files) {
			void Promise.all(
				files.map((file) =>
					AttachmentService.create({
						client,
						item: {
							name: PathUtils.name(file.path),
							value: file.path,
							directory: file.directory,
						},
					}),
				),
			).then((nodes) => {
				insert(
					nodes
						.map((node) => `${AtomUtils.fromNode({ content, node })} `)
						.join(""),
				);
			});
			return;
		}

		// Pasted into a block of code already, it is code and goes in as it is.
		const isInCode = MarkdownUtils.codeBlocks(content).some(
			({ start, code }) => offset >= start && offset <= start + code.length,
		);
		const classified = isInCode ? null : EditorNodeUtils.paste(pasted);

		if (classified?.type === "node")
			insert(AtomUtils.fromNode({ content, node: classified.node }));
		else if (classified?.type === "code")
			insert(PasteUtils.fence(classified.text, classified.language));
		else insert(pasted);
	};

	// An image on the clipboard never reaches stdin: the terminal drops it, and
	// a paste either arrives empty or carries the file's name instead. Ctrl+V
	// goes to the clipboard itself, which is the only way to reach one — and
	// stands in for the paste altogether on terminals that cannot bracket one.
	useInput(
		(input, key) => {
			if (!key.ctrl || input !== "v") return;

			void (async () => {
				const clipboard = await ClipboardService.read();
				if (!clipboard) return;

				if (clipboard.type === "text") {
					paste(clipboard.text);
					return;
				}

				const name = `Pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
				upload.mutate({
					kind: "ATTACHMENT",
					file: new File([clipboard.data], name, { type: "image/png" }),
				});
			})();
		},
		{ isActive: !disabled },
	);

	const isNavigating = isCompletionsOpen && !isCompletionsEmpty;

	/** The edit Tab, or Shift and Tab, makes in the list or the code the cursor is in. */
	const indent = (key: Key) =>
		disabled || isNavigating
			? null
			: MarkdownUtils.indented({
					value: content,
					selection: selection ?? [offset, offset],
					direction: key.shift ? -1 : 1,
				});

	useInput(
		(_, key) => {
			if (!key.tab) return;
			// Shift+Tab keeps its project/suggestion shortcuts in the editor and
			// tool controls. Completion and Markdown indentation take precedence
			// while the editor has focus.
			if (key.shift && (focus === "editor" || focus.startsWith("tool:")))
				return;
			if (focus === "editor" && (isNavigating || indent(key))) return;
			cycleFocus(key.shift ? -1 : 1);
		},
		{ isActive: !_disabled },
	);

	// Keys the text area would otherwise answer on its own. The completions take
	// Enter and the arrows while they are open; and Alt and a delete takes out
	// the word the arrows step, stopping against an atom rather than cutting
	// into one.
	const handleKey = (input: string, key: Key) => {
		if (isCompletionsOpen && key.return && !key.ctrl && !key.meta) return true;

		if (
			isNavigating &&
			(key.upArrow ||
				key.downArrow ||
				key.leftArrow ||
				key.rightArrow ||
				(key.meta && (input === "b" || input === "f")))
		)
			return true;

		if (!selection && key.meta && (key.backspace || key.delete)) {
			remove(key.backspace ? backwardWord : forwardWord);
			return true;
		}

		// The completions fill in their item on Tab.
		if (key.tab) return isNavigating || indent(key);

		// Ctrl+I only reaches here apart from Tab over the kitty protocol.
		if (key.ctrl && (input === "b" || input === "i"))
			return MarkdownUtils.toggled({
				value: content,
				selection: selection ?? [offset, offset],
				size: input === "b" ? 2 : 1,
			});
	};

	return (
		<Panel id="editor" disabled={_disabled}>
			{!disabled && (
				<>
					<Shell />
					<Commands
						content={content}
						setContent={setContent}
						cursor={cursor}
						setCursor={setCursor}
					/>
					<Attachments
						content={content}
						setContent={setContent}
						cursor={cursor}
						setCursor={setCursor}
					/>
				</>
			)}
			<Box
				paddingX={2}
				paddingY={1}
				backgroundColor="interior"
				borderStyle="round"
				border={true}
				alignItems="flex-end"
			>
				<Textarea
					focus={!disabled}
					value={content}
					onChange={handleChange}
					onPaste={paste}
					cursor={cursor}
					onCursorChange={setCursor}
					selection={selection}
					onSelectionChange={setSelection}
					// An atom is only ever stepped over, selected and deleted whole.
					snap={(target, from) =>
						EditorUtils.snap({ value: content, atoms, offset: target, from })
					}
					expand={(selected) =>
						EditorUtils.expand({ value: content, atoms, selection: selected })
					}
					// A newline carries the block it was pressed in on — a list keeps
					// its bullet, a quote its marker — rather than starting a bare line.
					onEnter={() => {
						const broken = selection
							? null
							: MarkdownUtils.broken({ value: content, offset });

						if (broken) write(broken);
						else insert("\n");
					}}
					onSubmit={() => {
						if (isNavigating) return;
						// A paste still open goes out as the paste it was.
						refold(true);
						sendMessage.mutate();
					}}
					// A paste is clicked open, written out in full to be read and
					// edited until the cursor leaves it.
					onClick={unfold}
					onKey={handleKey}
					labels={labels}
					styles={styles}
					placeholder={placeholder}
				/>
				<TokenUsage usage={usage} categories={categories} />
			</Box>
		</Panel>
	);
}
