import {
	type DefaultMantineColor,
	InputBase,
	InputWrapper,
	ScrollAreaAutosize,
} from "@mantine/core";
import { Tiptap } from "@tiptap/react";
import { useLayoutEffect, useRef, useState } from "react";
import type {
	Categories,
	Usage,
} from "#client/features/editor/hooks/useEstimatedTokens.ts";
import Capabilities from "#gui/features/editor/components/Capabilities.tsx";
import LeftSection from "#gui/features/editor/components/LeftSection.tsx";
import RightSection from "#gui/features/editor/components/RightSection.tsx";
import Shell from "#gui/features/editor/components/Shell.tsx";
import { useComposerSwipe } from "#gui/features/editor/hooks/useComposerSwipe.ts";
import { useEditor } from "#gui/features/editor/hooks/useEditor.tsx";
import Uploads from "#gui/features/upload/components/Uploads.tsx";
import Actions from "#gui/features/user/components/Actions.tsx";
import Memories from "#gui/features/user/components/Memories.tsx";

export default function Editor({
	width,
	bdrs,
	disabled,
	usage,
	categories,
}: {
	width: number;
	bdrs?: number;
	disabled: boolean;
	usage: Usage<DefaultMantineColor>;
	categories: Categories;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const leftSectionRef = useRef<HTMLDivElement>(null);
	const rightSectionRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLDivElement>(null);

	const { editor, isMultiline } = useEditor({
		ref: scrollRef,
		disabled: disabled,
	});
	useComposerSwipe({ ref: composerRef, editor });

	const [sectionWidths, setSectionWidths] = useState({ left: 42, right: 42 });
	useLayoutEffect(() => {
		const updateWidths = () => {
			const leftWidth = leftSectionRef.current?.offsetWidth ?? 42;
			const rightWidth = rightSectionRef.current?.offsetWidth ?? 42;
			setSectionWidths({ left: leftWidth, right: rightWidth });
		};

		updateWidths();
		const observer = new ResizeObserver(updateWidths);

		if (leftSectionRef.current) observer.observe(leftSectionRef.current);
		if (rightSectionRef.current) observer.observe(rightSectionRef.current);

		return () => observer.disconnect();
	}, []);

	return (
		<>
			<Shell>
				<InputWrapper ref={composerRef} bdrs={bdrs}>
					<InputBase
						className="chat-input"
						component="div"
						multiline
						pointer
						disabled={disabled}
						leftSection={
							<div
								ref={leftSectionRef}
								style={{
									display: "flex",
									alignItems: "center",
									opacity: isMultiline ? 0 : 1,
									pointerEvents: isMultiline ? "none" : "auto",
									transition: "opacity 200ms ease",
								}}
							>
								<LeftSection disabled={disabled} />
							</div>
						}
						rightSection={
							<div
								ref={rightSectionRef}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "5px",
									opacity: isMultiline ? 0 : 1,
									pointerEvents: isMultiline ? "none" : "auto",
									transition: "opacity 200ms ease",
								}}
							>
								<RightSection
									width={width}
									disabled={disabled}
									usage={usage}
									categories={categories}
									hidden={isMultiline}
								/>
							</div>
						}
						style={{
							"--input-left-section-width": "auto",
							"--input-right-section-width": "auto",
						}}
						radius={bdrs}
						styles={{
							input: {
								padding: 5,
								wordBreak: "break-word",
							},
							section: {
								display: "flex",
								alignItems: "center",
								margin: "5px",
								pointerEvents: "none",
							},
						}}
						onClick={() => editor.commands.focus()}
					>
						<ScrollAreaAutosize
							ref={scrollRef}
							type="auto"
							mah="75vh"
							style={{
								paddingLeft: (!isMultiline ? sectionWidths.left : 0) + 10,
								paddingRight: (!isMultiline ? sectionWidths.right : 0) + 10,
								paddingTop: 5,
								paddingBottom: 5,
								minHeight: "var(--input-height)",
								cursor: disabled ? "not-allowed" : "text",
								transition: "padding-left 200ms ease, padding-right 200ms ease",
							}}
						>
							<Tiptap editor={editor}>
								<Tiptap.Content
									autoCapitalize="on"
									autoComplete="off"
									autoCorrect="off"
									spellCheck={false}
								/>
							</Tiptap>
						</ScrollAreaAutosize>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								maxHeight: isMultiline ? 50 : 0,
								opacity: isMultiline ? 1 : 0,
								overflow: "hidden",
								pointerEvents: isMultiline ? "auto" : "none",
								transition:
									"max-height 200ms ease, opacity 200ms ease, padding-bottom 200ms ease",
							}}
						>
							<div style={{ display: "flex", alignItems: "center" }}>
								<LeftSection disabled={disabled} />
							</div>
							<div
								style={{ display: "flex", alignItems: "center", gap: "5px" }}
							>
								<RightSection
									width={width}
									disabled={disabled}
									usage={usage}
									categories={categories}
									hidden={!isMultiline}
								/>
							</div>
						</div>
					</InputBase>
				</InputWrapper>
			</Shell>
			<Uploads />
			<Capabilities />
			<Memories />
			<Actions />
		</>
	);
}
