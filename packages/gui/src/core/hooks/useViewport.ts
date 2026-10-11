import { useEffect, useRef, useState } from "react";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";

/** UIKit's keyboard curve, as measured. */
const KEYBOARD_EASING = "cubic-bezier(0.38, 0.7, 0.125, 1)";

/**
 * The visual viewport's height, and a container ref that follows it.
 *
 * Where the runtime draws its keyboard over the page instead, the container
 * also gets `--keyboard-inset`, how much of the page the keyboard covers, and
 * `--keyboard-transition`, the CSS timing that follows it there. Heights that
 * subtract the inset shrink the page from the bottom in step with the
 * keyboard, so nothing above it moves and whatever it covers can be scrolled
 * back up. They are set on the element directly so the keyboard never waits
 * on a render.
 */
export function useViewport() {
	const runtime = useRuntime();
	const [height, setHeight] = useState(
		window.visualViewport?.height ?? window.innerHeight,
	);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		let frameId: number;

		const onUpdate = () => {
			cancelAnimationFrame(frameId);
			frameId = requestAnimationFrame(() => {
				setHeight(vv.height);
				if (containerRef.current)
					containerRef.current.style.transform = `translateY(${vv.offsetTop}px)`;
			});
		};

		// Immediately set initial values
		onUpdate();

		vv.addEventListener("resize", onUpdate);
		vv.addEventListener("scroll", onUpdate);
		return () => {
			cancelAnimationFrame(frameId);
			vv.removeEventListener("resize", onUpdate);
			vv.removeEventListener("scroll", onUpdate);
		};
	}, []);

	useEffect(() => {
		let timeoutId: ReturnType<typeof setTimeout>;
		const unsubscribe = runtime.onKeyboard?.(({ height, duration }) => {
			const style = containerRef.current?.style;
			if (!style) return;
			clearTimeout(timeoutId);
			style.setProperty(
				"--keyboard-transition",
				`${duration}s ${KEYBOARD_EASING}`,
			);
			style.setProperty("--keyboard-inset", `${height}px`);
			// Anything else that resizes the page, such as a rotation, does so at
			// once; the margin lets the transition finish first.
			timeoutId = setTimeout(
				() => style.removeProperty("--keyboard-transition"),
				duration * 1000 + 100,
			);
		});
		return () => {
			clearTimeout(timeoutId);
			unsubscribe?.();
		};
	}, [runtime]);

	return { height, containerRef };
}
