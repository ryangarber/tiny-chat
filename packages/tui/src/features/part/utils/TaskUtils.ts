import chalk, { type ChalkInstance } from "chalk";
import { ColorUtils } from "#core/core/utils/ColorUtils.ts";

/** How long a crest takes to travel one wavelength, as in the GUI's. */
const SHIMMER_CYCLE = 2000;
/** The shortest wavelength, so a short label still reads as a gradient. */
const SHIMMER_MIN_WAVELENGTH = 24;

export type StatusPart = { text: string; style?: ChalkInstance };

export const TaskUtils = {
	style: (
		parts: StatusPart[],
		apply?: (style: ChalkInstance) => ChalkInstance,
	): (StatusPart & { style: ChalkInstance })[] => {
		return parts.map((part) => {
			const style = part.style ?? chalk;
			return {
				...part,
				style: apply?.(style) ?? style,
			};
		});
	},

	plain: ({
		parts,
		style,
		join = "",
	}: {
		parts: StatusPart[];
		style?: (style: ChalkInstance) => ChalkInstance;
		join?: string;
	}): string => {
		return TaskUtils.style(parts, style)
			.map(({ text, style }) => style(text))
			.join(join);
	},

	/**
	 * A triangle wave of brightness, one wavelength the width of the text,
	 * drifting rightward, like the GUI's gradient. Its phase is wall-clock time
	 * rather than length times time, so a label that grows as it streams only
	 * stretches the wave instead of throwing the crest somewhere else.
	 */
	shimmer: ({
		parts,
		style,
		time,
		base,
		highlight,
	}: {
		parts: StatusPart[];
		style?: (style: ChalkInstance) => ChalkInstance;
		time: number;
		base: string;
		highlight: string;
	}): string => {
		const characters = parts.flatMap((part, partIndex) =>
			[...(partIndex > 0 ? " " : ""), ...part.text].map(
				(character): StatusPart => ({
					text: character,
					style: style?.(part.style ?? chalk) ?? part.style,
				}),
			),
		);
		const wavelength = Math.max(characters.length, SHIMMER_MIN_WAVELENGTH);
		const phase = (time % SHIMMER_CYCLE) / SHIMMER_CYCLE;

		return characters
			.map((part, i) => {
				const position = ((i + 0.5) / wavelength - phase + 1) % 1;
				const brightness = 1 - Math.abs(2 * position - 1);

				return TaskUtils.plain({
					parts: [part],
					style: (style) =>
						style.hex(ColorUtils.lerp(base, highlight, brightness)),
				});
			})
			.join("");
	},
} as const;
