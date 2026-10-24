import { type RefObject, useEffect } from "react";
import { useLayoutStore } from "#client/core/stores/useLayoutStore.ts";
import { AppService } from "#gui/core/services/AppService.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";

/** How far a touch travels before it counts as a swipe or a scroll. */
const SLOP = 8;
/** How long a release's velocity carries it, in ms, when deciding where it lands. */
const PROJECTION = 300;
/** How far back, in ms, a release's velocity is measured. */
const VELOCITY_WINDOW = 80;

type Panel = {
	element: HTMLElement;
	/** +1 when the panel opens toward the right (it sits on the left), else -1. */
	side: 1 | -1;
	/** Whether the panel started open. */
	open: boolean;
	commit: (open: boolean) => void;
};

type Swipe = {
	x: number;
	y: number;
	target: Element;
	locked: boolean;
	panel?: Panel;
	width: number;
	transform: string;
	transition: string;
	samples: { x: number; t: number }[];
};

/**
 * Whether the touch began on something that takes a horizontal drag itself:
 * content scrolled away from the edge it is swiped toward, a slider, or a
 * pan-and-zoom surface.
 */
function claimsDrag(target: Element, dx: number) {
	if (target.closest("input[type=range], [role=slider], [data-no-swipe]"))
		return true;
	for (
		let element: Element | null = target;
		element && element !== document.body;
		element = element.parentElement
	) {
		const style = getComputedStyle(element);
		if (style.touchAction === "none") return true;
		if (
			(style.overflowX === "auto" || style.overflowX === "scroll") &&
			element.scrollWidth > element.clientWidth + 1
		) {
			const canScroll =
				dx > 0
					? element.scrollLeft > 0
					: element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
			if (canScroll) return true;
		}
	}
	return false;
}

/**
 * Whatever is on top, if a swipe can close it: a drawer over everything, then
 * the open sidebar or aside. Nothing while a modal is up.
 */
function topPanel({
	navbar,
	aside,
}: {
	navbar: HTMLElement | null;
	aside: HTMLElement | null;
}): Panel | null | undefined {
	const { currentModal, currentDrawer } = useAppStore.getState();
	const { panels } = useLayoutStore.getState();
	if (currentModal || document.querySelector(".mantine-Modal-content"))
		return null;
	if (currentDrawer) {
		const element = document.querySelector<HTMLElement>(
			".mantine-Drawer-content",
		);
		if (!element) return null;
		return {
			element,
			side: element.getBoundingClientRect().left <= 1 ? 1 : -1,
			open: true,
			commit: (open) => {
				if (!open) AppService.closeSidebar();
			},
		};
	}
	if (panels.chats && navbar)
		return {
			element: navbar,
			side: 1,
			open: true,
			commit: (open) => useLayoutStore.getState().setPanel("chats", open),
		};
	if (panels.files && aside)
		return {
			element: aside,
			side: -1,
			open: true,
			commit: (open) => useLayoutStore.getState().setPanel("files", open),
		};
	// Nothing is open: the swipe's direction picks what it opens.
	return undefined;
}

/**
 * Swipes the mobile sidebar and aside open from anywhere on the chat, and
 * swipes whatever is on top closed. The panel follows the finger, and a flick
 * carries it the rest of the way. One gesture moves one panel, so closing a
 * drawer never closes the sidebar behind it.
 */
export function usePanelSwipe({
	navbarRef,
	asideRef,
}: {
	navbarRef: RefObject<HTMLElement | null>;
	asideRef: RefObject<HTMLElement | null>;
}) {
	useEffect(() => {
		let swipe: Swipe | null = null;

		const offset = (panel: Panel, dx: number, width: number) => {
			// How far open the panel is, from 0 to 1.
			const start = panel.open ? 1 : 0;
			const progress = Math.min(
				1,
				Math.max(0, start + (dx * panel.side) / width),
			);
			return { progress, x: (progress - 1) * width * panel.side };
		};

		const onTouchStart = (event: TouchEvent) => {
			swipe = null;
			if (event.touches.length !== 1 || !useAppStore.getState().isMobile)
				return;
			const touch = event.touches[0];
			if (!(event.target instanceof Element)) return;
			swipe = {
				x: touch.clientX,
				y: touch.clientY,
				target: event.target,
				locked: false,
				width: 0,
				transform: "",
				transition: "",
				samples: [{ x: touch.clientX, t: event.timeStamp }],
			};
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!swipe) return;
			if (event.touches.length !== 1) {
				cancel();
				return;
			}
			const touch = event.touches[0];
			const dx = touch.clientX - swipe.x;
			const dy = touch.clientY - swipe.y;

			if (!swipe.locked) {
				if (Math.hypot(dx, dy) < SLOP) return;
				// A mostly vertical move is a scroll; leave it be.
				if (Math.abs(dx) < Math.abs(dy) * 1.2 || !event.cancelable) {
					swipe = null;
					return;
				}
				let panel = topPanel({
					navbar: navbarRef.current,
					aside: asideRef.current,
				});
				if (panel === undefined) {
					const element = dx > 0 ? navbarRef.current : asideRef.current;
					if (element)
						panel = {
							element,
							side: dx > 0 ? 1 : -1,
							open: false,
							commit: (open) =>
								dx > 0
									? useLayoutStore.getState().setPanel("chats", open)
									: useLayoutStore.getState().setPanel("files", open),
						};
				}
				// Only a swipe toward closing moves an open panel.
				if (
					!panel ||
					(panel.open && Math.sign(dx) === panel.side) ||
					claimsDrag(swipe.target, dx)
				) {
					swipe = null;
					return;
				}
				swipe.locked = true;
				swipe.panel = panel;
				swipe.width = panel.element.offsetWidth || window.innerWidth;
				swipe.transform = panel.element.style.transform;
				swipe.transition = panel.element.style.transition;
				panel.element.style.transition = "none";
				document.body.classList.add("unselectable");
			}

			event.preventDefault();
			const panel = swipe.panel as Panel;
			const { x } = offset(panel, touch.clientX - swipe.x, swipe.width);
			panel.element.style.transform = `translateX(${x}px)`;
			swipe.samples.push({ x: touch.clientX, t: event.timeStamp });
			while (
				swipe.samples.length > 2 &&
				event.timeStamp - swipe.samples[0].t > VELOCITY_WINDOW
			)
				swipe.samples.shift();
		};

		const finish = (event: TouchEvent) => {
			const current = swipe;
			swipe = null;
			if (!current?.locked || !current.panel) return;
			document.body.classList.remove("unselectable");
			const { panel, samples } = current;
			const touch = event.changedTouches[0];
			const lastX = touch?.clientX ?? current.x;
			const { progress } = offset(panel, lastX - current.x, current.width);
			const first = samples[0];
			const elapsed = event.timeStamp - first.t;
			const velocity = elapsed > 0 ? (lastX - first.x) / elapsed : 0;
			const projected =
				progress + (velocity * panel.side * PROJECTION) / current.width;
			const open = projected > 0.5;

			// Hand the panel back to its own transition, which carries it from
			// where the finger left it.
			panel.element.style.transition = current.transition;
			if (open === panel.open) {
				panel.element.style.transform = current.transform;
				return;
			}
			panel.commit(open);
			// A closing drawer's exit transition takes over its transform; the
			// sidebar and aside wait a frame for their new state to render.
			if (panel.element.classList.contains("mantine-Drawer-content")) return;
			requestAnimationFrame(() => {
				panel.element.style.transform = current.transform;
			});
		};

		const cancel = () => {
			if (swipe?.locked && swipe.panel) {
				swipe.panel.element.style.transition = swipe.transition;
				swipe.panel.element.style.transform = swipe.transform;
				document.body.classList.remove("unselectable");
			}
			swipe = null;
		};

		const onTouchEnd = (event: TouchEvent) => finish(event);
		const onTouchCancel = () => cancel();

		window.addEventListener("touchstart", onTouchStart, {
			capture: true,
			passive: true,
		});
		window.addEventListener("touchmove", onTouchMove, {
			capture: true,
			passive: false,
		});
		window.addEventListener("touchend", onTouchEnd, { capture: true });
		window.addEventListener("touchcancel", onTouchCancel, { capture: true });
		return () => {
			window.removeEventListener("touchstart", onTouchStart, {
				capture: true,
			});
			window.removeEventListener("touchmove", onTouchMove, { capture: true });
			window.removeEventListener("touchend", onTouchEnd, { capture: true });
			window.removeEventListener("touchcancel", onTouchCancel, {
				capture: true,
			});
		};
	}, [navbarRef, asideRef]);
}
