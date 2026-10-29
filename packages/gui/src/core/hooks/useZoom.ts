import {
	type CSSProperties,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

const MIN = 0.25;
const MAX = 5;
/** How much one press of `Mod`+`+` / `Mod`+`-`, or one button, scales by. */
const STEP = 1.25;
/** How sharply a pinch's wheel deltas scale; larger mouse-wheel ticks are capped. */
const WHEEL_RATE = 0.01;
const WHEEL_CAP = 50;

type Point = { x: number; y: number };
/** A point on screen and where it sits in the unzoomed content, kept still across a zoom. */
type Anchor = { client: Point; content: Point };

/** Safari's trackpad (macOS) and touch (iOS) pinch, which no DOM lib types. */
type GestureEvent = UIEvent & {
	scale: number;
	clientX: number;
	clientY: number;
};

const clamp = (zoom: number) => Math.min(MAX, Math.max(MIN, zoom));

const distance = (touches: TouchList) =>
	Math.hypot(
		touches[0].clientX - touches[1].clientX,
		touches[0].clientY - touches[1].clientY,
	);

const midpoint = (touches: TouchList): Point => ({
	x: (touches[0].clientX + touches[1].clientX) / 2,
	y: (touches[0].clientY + touches[1].clientY) / 2,
});

/** `Mod`+`+` (or `=`) zooms in, `Mod`+`-` out, `Mod`+`0` resets. */
const keyZoom = (event: KeyboardEvent) => {
	if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
	if (event.key === "+" || event.key === "=") return STEP;
	if (event.key === "-" || event.key === "_") return 1 / STEP;
	if (event.key === "0") return 0;
};

/**
 * Magnifies whatever is laid out in `content` without reflowing it, like an
 * image viewer: `content` keeps the width of `scroller` and is scaled, while
 * `frame` takes up its scaled size so `scroller` pans it natively. Being a
 * transform, it leaves links, inputs, menus and embeds working as they were.
 *
 * While `scroller` is mounted, it takes `Mod`+`+` / `Mod`+`-` / `Mod`+`0` from
 * the whole window, and pinches (trackpad on macOS, touch on iOS and Android,
 * or `Ctrl`+wheel) over `scroller`, keeping the point under the pinch still.
 * It goes back to 1 once `scroller` unmounts.
 */
export function useZoom() {
	// Elements, not refs, as a modal or transition may mount them a render later.
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const [frame, setFrame] = useState<HTMLDivElement | null>(null);
	const [content, setContent] = useState<HTMLDivElement | null>(null);
	const [zoom, setZoom] = useState(1);
	const [size, setSize] = useState<{ width: number; height: number }>();
	const zoomRef = useRef(zoom);
	const anchorRef = useRef<Anchor>(undefined);

	/** Where `client` sits in the unzoomed content, or the middle of the view. */
	const anchorAt = useCallback(
		(client?: Point): Anchor | undefined => {
			if (!(scroller && frame)) return;
			const view = scroller.getBoundingClientRect();
			const point = client ?? {
				x: view.left + view.width / 2,
				y: view.top + view.height / 2,
			};
			const rect = frame.getBoundingClientRect();
			return {
				client: point,
				content: {
					x: (point.x - rect.left) / zoomRef.current,
					y: (point.y - rect.top) / zoomRef.current,
				},
			};
		},
		[scroller, frame],
	);

	const zoomTo = useCallback(
		(next: number, client?: Point) => {
			const zoom = clamp(next);
			if (zoom === zoomRef.current) return;
			anchorRef.current = anchorAt(client);
			zoomRef.current = zoom;
			setZoom(zoom);
		},
		[anchorAt],
	);

	const zoomIn = useCallback(() => zoomTo(zoomRef.current * STEP), [zoomTo]);
	const zoomOut = useCallback(() => zoomTo(zoomRef.current / STEP), [zoomTo]);
	const reset = useCallback(() => zoomTo(1), [zoomTo]);

	// Back to 1 for the next time it mounts.
	const mountScroller = useCallback((node: HTMLDivElement | null) => {
		setScroller(node);
		if (node) return;
		anchorRef.current = undefined;
		zoomRef.current = 1;
		setZoom(1);
	}, []);

	// The unzoomed layout: as wide as the view, as tall as that makes it. Its
	// width holds while zoomed, so scrollbars coming and going don't reflow it.
	useLayoutEffect(() => {
		if (!(scroller && content)) return;
		const measure = () =>
			setSize((size) => {
				const width =
					zoomRef.current === 1 || !size ? scroller.clientWidth : size.width;
				const height = content.offsetHeight;
				return size?.width === width && size.height === height
					? size
					: { width, height };
			});
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(scroller);
		observer.observe(content);
		return () => observer.disconnect();
	}, [scroller, content]);

	// Scroll so the anchor stays under the pointer, once the new size is laid out.
	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		anchorRef.current = undefined;
		if (!(anchor && scroller && frame)) return;
		const rect = frame.getBoundingClientRect();
		scroller.scrollBy(
			rect.left + anchor.content.x * zoom - anchor.client.x,
			rect.top + anchor.content.y * zoom - anchor.client.y,
		);
	}, [zoom, scroller, frame]);

	useEffect(() => {
		if (!scroller) return;

		const onKeyDown = (event: KeyboardEvent) => {
			const step = keyZoom(event);
			if (step === undefined) return;
			// Also keeps the browser or webview from zooming the whole page.
			event.preventDefault();
			if (step === 0) zoomTo(1);
			else zoomTo(zoomRef.current * step);
		};

		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [scroller, zoomTo]);

	useEffect(() => {
		if (!scroller) return;

		/** A touch pinch's starting zoom and finger spread. */
		let pinch: { zoom: number; distance: number } | undefined;
		/** A Safari gesture's starting zoom, unless a touch pinch has it. */
		let gesture: number | undefined;

		// Chromium and Firefox report a trackpad pinch as a wheel with `ctrlKey`.
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey) return;
			event.preventDefault();
			const delta = Math.min(WHEEL_CAP, Math.max(-WHEEL_CAP, event.deltaY));
			zoomTo(zoomRef.current * Math.exp(-delta * WHEEL_RATE), {
				x: event.clientX,
				y: event.clientY,
			});
		};

		// Touch pinches on iOS and Android; one finger still scrolls natively.
		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 2) return;
			pinch = { zoom: zoomRef.current, distance: distance(event.touches) };
		};
		const onTouchMove = (event: TouchEvent) => {
			if (!pinch || event.touches.length !== 2) return;
			event.preventDefault();
			zoomTo(
				(pinch.zoom * distance(event.touches)) / pinch.distance,
				midpoint(event.touches),
			);
		};
		const onTouchEnd = (event: TouchEvent) => {
			if (event.touches.length < 2) pinch = undefined;
		};

		// Safari's own pinch events: the trackpad on macOS, and on iOS alongside
		// the touches above, which take it there. Cancelling them also keeps the
		// page itself from zooming.
		const onGestureStart = (event: Event) => {
			event.preventDefault();
			gesture = pinch ? undefined : zoomRef.current;
		};
		const onGestureChange = (event: Event) => {
			event.preventDefault();
			if (gesture === undefined || pinch) return;
			const { scale, clientX, clientY } = event as GestureEvent;
			zoomTo(gesture * scale, { x: clientX, y: clientY });
		};
		const onGestureEnd = (event: Event) => {
			event.preventDefault();
			gesture = undefined;
		};

		const options = { passive: false } as const;
		scroller.addEventListener("wheel", onWheel, options);
		scroller.addEventListener("touchstart", onTouchStart, options);
		scroller.addEventListener("touchmove", onTouchMove, options);
		scroller.addEventListener("touchend", onTouchEnd);
		scroller.addEventListener("touchcancel", onTouchEnd);
		scroller.addEventListener("gesturestart", onGestureStart, options);
		scroller.addEventListener("gesturechange", onGestureChange, options);
		scroller.addEventListener("gestureend", onGestureEnd, options);
		return () => {
			scroller.removeEventListener("wheel", onWheel);
			scroller.removeEventListener("touchstart", onTouchStart);
			scroller.removeEventListener("touchmove", onTouchMove);
			scroller.removeEventListener("touchend", onTouchEnd);
			scroller.removeEventListener("touchcancel", onTouchEnd);
			scroller.removeEventListener("gesturestart", onGestureStart);
			scroller.removeEventListener("gesturechange", onGestureChange);
			scroller.removeEventListener("gestureend", onGestureEnd);
		};
	}, [scroller, zoomTo]);

	const scaled = zoom !== 1 && size;

	return {
		zoom,
		canZoomIn: zoom < MAX,
		canZoomOut: zoom > MIN,
		zoomIn,
		zoomOut,
		reset,
		/** Callback refs for the three elements. */
		setScroller: mountScroller,
		setFrame,
		setContent,
		scrollerStyle: {
			display: "flex",
			overflow: "auto",
			overscrollBehavior: "contain",
			touchAction: "pan-x pan-y",
		} satisfies CSSProperties,
		// `margin: auto` centers it once it is smaller than the view, and drops
		// to 0 once it overflows, so none of it scrolls out of reach.
		frameStyle: (scaled
			? {
					position: "relative",
					flexShrink: 0,
					margin: "auto",
					width: size.width * zoom,
					height: size.height * zoom,
				}
			: { flexShrink: 0, width: "100%" }) satisfies CSSProperties,
		// At 1 it is laid out as it always was, without a transform's
		// containing block for anything fixed or sticky inside it.
		contentStyle: (scaled
			? {
					position: "absolute",
					top: 0,
					left: 0,
					width: size.width,
					transform: `scale(${zoom})`,
					transformOrigin: "0 0",
				}
			: {}) satisfies CSSProperties,
	};
}

export type ZoomControls = Pick<
	ReturnType<typeof useZoom>,
	"zoom" | "canZoomIn" | "canZoomOut" | "zoomIn" | "zoomOut" | "reset"
>;
