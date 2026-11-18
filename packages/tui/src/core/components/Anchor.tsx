import { Text, type TextProps } from "better-ink-ui";
import { Transform } from "ink";
import { type ReactNode, useContext } from "react";
import link from "terminal-link";
import { ThemeContext } from "#client/core/components/ThemeContext.tsx";

export default function Anchor({
	href,
	children,
	...props
}: TextProps & {
	href?: string;
	children?: ReactNode;
}) {
	const { colorScheme } = useContext(ThemeContext);

	if (!href) {
		return <Text {...props}>{children}</Text>;
	}

	children ??= href;

	return (
		<Transform transform={(text) => link(text, href, { fallback: false })}>
			<Text color={colorScheme.primary} {...props}>
				{children}
			</Text>
		</Transform>
	);
}
