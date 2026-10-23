/** @author https://github.com/vercel/streamdown/blob/main/packages/streamdown/hooks/use-deferred-render.ts */

import { useEffect, useRef, useState } from "react";

/**
 * Default debounce delay in milliseconds before checking if element is still in view
 */
const DEFERRED_RENDER_DEBOUNCE_DELAY = 300;

/**
 * Default root margin for Intersection Observer
 * Starts rendering when element is 200px away from viewport
 */
const DEFERRED_RENDER_ROOT_MARGIN = "300px";

/**
 * Default timeout for requestIdleCallback in milliseconds
 */
const DEFERRED_RENDER_IDLE_TIMEOUT = 500;

const hasIdleCallback =
	typeof window !== "undefined" && "requestIdleCallback" in window;

// Polyfill for requestIdleCallback
const requestIdle = (
	callback: IdleRequestCallback,
	opts?: IdleRequestOptions,
): number => {
	if (hasIdleCallback) return window.requestIdleCallback(callback, opts);
	const start = Date.now();
	return window.setTimeout(() => {
		callback({
			didTimeout: false,
			timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
		});
	}, 1);
};

const cancelIdle = (id: number) => {
	if (hasIdleCallback) window.cancelIdleCallback(id);
	else clearTimeout(id);
};

export interface UseDeferredRenderOptions {
	/**
	 * Debounce delay in milliseconds before checking if still in view
	 * @default DEFERRED_RENDER_DEBOUNCE_DELAY
	 */
	debounceDelay?: number;
	/**
	 * Timeout for requestIdleCallback in milliseconds
	 * @default DEFERRED_RENDER_IDLE_TIMEOUT
	 */
	idleTimeout?: number;
	/**
	 * If true, render immediately without waiting for intersection
	 * @default false
	 */
	immediate?: boolean;
	/**
	 * Root margin for Intersection Observer (e.g., '200px' to start rendering 200px before entering viewport)
	 * @default DEFERRED_RENDER_ROOT_MARGIN
	 */
	rootMargin?: string;
}

/**
 * Hook for deferred rendering components when they enter the viewport.
 * Uses Intersection Observer + debounce + requestIdleCallback for optimal performance.
 *
 * @param options Configuration options
 * @returns Object containing `shouldRender` flag and `containerRef` to attach to the element
 *
 * @example
 * ```tsx
 * const { shouldRender, containerRef } = useDeferredRender({ immediate: false })
 *
 * return (
 *   <div ref={containerRef}>
 *     {shouldRender && <ExpensiveComponent />}
 *   </div>
 * )
 * ```
 */
export function useDeferredRender(options: UseDeferredRenderOptions = {}) {
	const {
		immediate = false,
		debounceDelay = DEFERRED_RENDER_DEBOUNCE_DELAY,
		rootMargin = DEFERRED_RENDER_ROOT_MARGIN,
		idleTimeout = DEFERRED_RENDER_IDLE_TIMEOUT,
	} = options;

	const [inView, setInView] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	// Once rendered, stay rendered
	const shouldRender = immediate || inView;

	useEffect(() => {
		if (shouldRender) return;

		const container = containerRef.current;
		/* v8 ignore next */
		if (!container) {
			return;
		}

		let renderTimeout: number | null = null;
		let idleCallback: number | null = null;

		const clearPendingRenders = () => {
			if (renderTimeout !== null) {
				clearTimeout(renderTimeout);
				renderTimeout = null;
			}
			if (idleCallback !== null) {
				cancelIdle(idleCallback);
				idleCallback = null;
			}
		};

		const render = () => {
			setInView(true);
			observer.disconnect();
		};

		const scheduleRender = () => {
			idleCallback = requestIdle(
				(deadline) => {
					// If we have time remaining or it's urgent, render
					if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
						render();
					} else {
						// Otherwise, schedule again with shorter timeout
						idleCallback = requestIdle(render, { timeout: idleTimeout / 2 });
					}
				},
				{ timeout: idleTimeout },
			);
		};

		const handleIntersecting = () => {
			clearPendingRenders();

			// Debounce rendering: wait for debounceDelay, then check if still in view
			renderTimeout = window.setTimeout(() => {
				// Re-check if element is still in viewport using observer records
				const records = observer.takeRecords();
				// If no records, element hasn't changed state (still intersecting)
				// If records exist, check the latest intersection state
				const isStillInView =
					records.length === 0 || (records.at(-1)?.isIntersecting ?? false);

				if (isStillInView) {
					scheduleRender();
				}
			}, debounceDelay);
		};

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						handleIntersecting();
					} else {
						clearPendingRenders();
					}
				}
			},
			{
				rootMargin,
				threshold: 0,
			},
		);

		observer.observe(container);

		return () => {
			clearPendingRenders();
			observer.disconnect();
		};
	}, [shouldRender, debounceDelay, rootMargin, idleTimeout]);

	return {
		shouldRender,
		containerRef,
	};
}
