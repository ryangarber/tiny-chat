import type { ColorName } from "chalk";
import type { LiteralUnion } from "type-fest";
import type { ColorScheme } from "#client/core/components/ThemeContext.tsx";

/**
 * A color `better-ink-ui` draws: a name from the app's color scheme (handed to
 * it in `Root`), a chalk color, a hex color — translucent ones are blended over
 * the surface — or channels. Narrower than the library's own `Color` only so
 * the scheme's names are suggested.
 */
export type Color =
	| LiteralUnion<ColorName | keyof ColorScheme, string>
	| { r: number; g: number; b: number; a?: number };
