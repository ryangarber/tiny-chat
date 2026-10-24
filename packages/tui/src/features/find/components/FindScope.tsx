import type { DOMElement } from "ink";
import {
	type ReactNode,
	type Ref,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
} from "react";
import {
	FindScopeContext,
	FindSegmentContext,
	useFindScope,
} from "#client/features/find/hooks/useFindScope.ts";
import { useFindStore } from "#client/features/find/stores/useFindStore.ts";
import Box, { type BoxProps } from "#tui/core/components/Box.tsx";
import {
	type Focus,
	selectFocus,
	useAppStore,
} from "#tui/core/stores/useAppStore.ts";

const mergeRefs =
	<T,>(...refs: (Ref<T> | undefined)[]) =>
	(node: T | null) => {
		for (const ref of refs) {
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		}
	};

/**
 * A part of the screen find can be scoped to: Ctrl+F searches the one last
 * clicked into, or the one whatever took the focus belongs to — `focus` says
 * which focus that is.
 */
export default function FindScope({
	id: _id,
	label,
	region,
	segmented,
	text,
	focus,
	ref: _ref,
	children,
	...props
}: BoxProps & {
	id?: string;
	label: string;
	region?: boolean;
	segmented?: boolean;
	text?: () => string[];
	/** Whether a focus taken is one inside this scope, making it the active one. */
	focus?: (focus: Focus) => boolean;
	ref?: Ref<DOMElement>;
	children?: ReactNode;
}) {
	const generated = useId();
	const id = _id ?? generated;
	const ref = useRef<DOMElement>(null);
	const value = useFindScope({ id, label, region, segmented, ref, text });

	const isInside = useEffectEvent((taken: Focus) => !!focus?.(taken));
	useEffect(() => {
		const activate = (focus: Focus) => {
			if (isInside(focus)) useFindStore.getState().activate(id);
		};
		activate(selectFocus(useAppStore.getState()));
		return useAppStore.subscribe((state, previous) => {
			const focus = selectFocus(state);
			if (focus !== selectFocus(previous)) activate(focus);
		});
	}, [id]);

	return (
		<Box ref={mergeRefs(ref, _ref)} flexDirection="column" {...props}>
			<FindScopeContext value={value.scope}>
				<FindSegmentContext value={value.segments}>
					{children}
				</FindSegmentContext>
			</FindScopeContext>
		</Box>
	);
}
