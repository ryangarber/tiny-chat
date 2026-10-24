import { Box, type BoxProps } from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import {
	type HTMLAttributes,
	type ReactNode,
	type Ref,
	useId,
	useRef,
} from "react";
import {
	FindScopeContext,
	FindSegmentContext,
	useFindScope,
} from "#client/features/find/hooks/useFindScope.ts";

/**
 * A part of the window find can be scoped to: the one last clicked or focused
 * into is the one Cmd/Ctrl+F searches. A `region` holds the find bar, drawn in
 * its top right corner, for itself and the scopes inside it — so it should be
 * positioned and not scroll itself.
 */
export default function FindScope({
	id: _id,
	label,
	region,
	segmented,
	text,
	ref: _ref,
	children,
	...props
}: BoxProps &
	HTMLAttributes<HTMLDivElement> & {
		id?: string;
		label: string;
		region?: boolean;
		segmented?: boolean;
		text?: () => string[];
		ref?: Ref<HTMLDivElement>;
		children?: ReactNode;
	}) {
	const generated = useId();
	const id = _id ?? generated;
	const ref = useRef<HTMLDivElement>(null);
	const mergedRef = useMergedRef(ref, _ref);
	const value = useFindScope({ id, label, region, segmented, ref, text });

	return (
		<Box ref={mergedRef} data-find-scope={id} {...props}>
			<FindScopeContext value={value.scope}>
				<FindSegmentContext value={value.segments}>
					{children}
				</FindSegmentContext>
			</FindScopeContext>
		</Box>
	);
}
