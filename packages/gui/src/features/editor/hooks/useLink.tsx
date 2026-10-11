import { Anchor } from "@mantine/core";
import { Link as _Link } from "@tiptap/extension-link";
import { MarkViewContent, ReactMarkViewRenderer } from "@tiptap/react";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";

const Link = _Link
	.configure({
		isAllowedUri: () => false,
	})
	.extend({
		addMarkView: () =>
			ReactMarkViewRenderer(({ mark }) => {
				const runtime = useRuntime();
				return (
					<Anchor
						className="wrap-anywhere font-medium text-primary underline"
						onClick={(e) => {
							if (!mark.attrs.href) return;
							e.preventDefault();
							void runtime.open(mark.attrs.href);
						}}
					>
						<MarkViewContent />
					</Anchor>
				);
			}),
	});

export const useLink = () => {
	return Link;
};
