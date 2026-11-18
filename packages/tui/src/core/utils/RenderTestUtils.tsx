import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { createStdin } from "better-ink-ui";
import { render as inkRender } from "ink";
import type { ReactNode } from "react";
import { afterEach } from "vitest";

/** Exercise the same streams and framing as main.tsx, not an EventEmitter mock. */
export const createTestInput = (isTTY = true) =>
	Object.assign(new PassThrough(), {
		isTTY,
		isRaw: false,
		setRawMode(mode: boolean) {
			this.isRaw = mode;
			return this;
		},
		ref() {
			return this;
		},
		unref() {
			return this;
		},
	});

const createOutput = () => {
	const frames: string[] = [];
	const writes: string[] = [];
	return Object.assign(
		new Writable({
			write(chunk: Buffer, _encoding, callback) {
				const frame = chunk.toString();
				writes.push(frame);
				// Tracking/keyboard negotiation is terminal output, not a UI frame.
				// Ink also writes an empty chunk as a render-flush barrier.
				if (stripVTControlCharacters(frame)) frames.push(frame);
				callback();
			},
		}),
		{
			columns: 100,
			rows: 24,
			isTTY: true,
			frames,
			writes,
			lastFrame: () => frames.at(-1),
		},
	);
};

/** Quiet the output has to keep before a screen counts as idle. */
const IDLE_MS = 30;

const cleanups = new Set<() => void>();
afterEach(() => {
	for (const cleanup of cleanups) cleanup();
});

export const render = (tree: ReactNode) => {
	const stdin = createTestInput();
	const filtered = createStdin(stdin);
	const stdout = createOutput();
	const stderr = createOutput();
	const instance = inkRender(tree, {
		stdin: filtered as unknown as NodeJS.ReadStream,
		stdout,
		stderr,
		debug: true,
		exitOnCtrlC: false,
		patchConsole: false,
	});
	const cleanup = () => {
		instance.unmount();
		instance.cleanup();
		filtered.destroy();
		stdin.destroy();
		cleanups.delete(cleanup);
	};
	cleanups.add(cleanup);

	/**
	 * Resolves once everything written to `stdin` has reached Ink and the
	 * renders it set off have stopped. The filter yields between the events of
	 * one read, so a fixed delay that covers them on an idle machine does not
	 * under load; this waits for the delivery itself instead.
	 * Pending protocol prefixes (including Escape) and async application work
	 * need an assertion on their expected result instead.
	 */
	const idle = async () => {
		await instance.waitUntilRenderFlush();
		const pending = () =>
			stdin.readableLength > 0 || filtered.writableLength > 0;
		for (;;) {
			while (pending()) await new Promise((resolve) => setImmediate(resolve));
			const writes = stdout.writes.length;
			await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
			if (!pending() && stdout.writes.length === writes) {
				await instance.waitUntilRenderFlush();
				return;
			}
		}
	};

	return {
		...instance,
		cleanup,
		idle,
		stdin,
		filtered,
		stdout,
		stderr,
		frames: stdout.frames,
		lastFrame: stdout.lastFrame,
	};
};
