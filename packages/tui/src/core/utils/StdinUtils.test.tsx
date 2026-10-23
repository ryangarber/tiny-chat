import { once } from "node:events";
import { PassThrough } from "node:stream";
import { type Key, useInput, usePaste } from "ink";
import { describe, expect, it, vi } from "vitest";
import { useMouse } from "#tui/core/hooks/useMouse.ts";
import type { MouseEvent } from "#tui/core/utils/MouseUtils.ts";
import { createTestInput, render } from "#tui/core/utils/RenderTestUtils.tsx";
import { StdinUtils } from "#tui/core/utils/StdinUtils.ts";

const ESC = "\x1b";
const click = `${ESC}[<0;10;20M`;
const paste = (text: string) => `${ESC}[200~${text}${ESC}[201~`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const collect = async (chunks: (string | Buffer)[]) => {
	const source = new PassThrough();
	const output = StdinUtils.filter(source);
	const keys: string[] = [];
	const mouse: MouseEvent[] = [];
	output.on("data", (chunk: string) => keys.push(chunk));
	// Reports split across chunks arrive later, which is all that tells them apart.
	output.on("mouse", (event: MouseEvent) => mouse.push({ ...event, time: 0 }));
	const ended = once(output, "end");
	for (const chunk of chunks) source.write(chunk);
	source.end();
	await ended;
	output.destroy();
	return { text: keys.join(""), mouse };
};

type Probed = {
	keys: { input: string; key: Key }[];
	pastes: string[];
	mouse: MouseEvent[];
};

function Probe({ keys, pastes, mouse }: Probed) {
	useInput((input, key) => keys.push({ input, key }));
	usePaste((text) => pastes.push(text));
	useMouse({ handler: (event) => mouse.push(event) });
	return null;
}

const probe = async () => {
	const keys: Probed["keys"] = [];
	const pastes: string[] = [];
	const mouse: MouseEvent[] = [];
	const screen = render(<Probe keys={keys} pastes={pastes} mouse={mouse} />);
	await screen.idle();
	return { ...screen, keys, pastes, mouse };
};

describe("terminal stream framing", () => {
	it.each([
		["SGR press", click],
		["SGR release", `${ESC}[<0;10;20m`],
		["SGR drag", `${ESC}[<32;999;888M`],
		["SGR hover", `${ESC}[<35;10;20M`],
		["SGR vertical wheel", `${ESC}[<65;10;20M`],
		["SGR horizontal wheel", `${ESC}[<67;10;20M`],
		["SGR modifiers", `${ESC}[<28;10;20M`],
	])("decodes %s at every byte boundary", async (_name, report) => {
		const expected = await collect([report]);
		expect(expected.text).toBe("");
		expect(expected.mouse).toHaveLength(1);
		for (let i = 1; i < report.length; i++) {
			expect(await collect([report.slice(0, i), report.slice(i)])).toEqual(
				expected,
			);
		}
		expect(await collect([...report])).toEqual(expected);
	});

	it("preserves surrounding keys and multiple mouse reports", async () => {
		const result = await collect([`a${click}b${ESC}[<0;10;20mc`]);
		expect(result.text).toBe("abc");
		expect(result.mouse.map((event) => event.type)).toEqual(["down", "up"]);
		expect(result.mouse[0]).toMatchObject({ x: 9, y: 19, button: "left" });
	});

	it("decodes split UTF-8, including inside bracketed paste", async () => {
		const text = `é中🙂é${paste("👨‍👩‍👧‍👦中文")}`;
		const bytes = Buffer.from(text);
		for (let i = 1; i < bytes.length; i++) {
			expect(
				(await collect([bytes.subarray(0, i), bytes.subarray(i)])).text,
			).toBe(text);
		}
		expect(
			(await collect([...bytes].map((byte) => Buffer.from([byte])))).text,
		).toBe(text);
	});

	it("keeps paste payload literal across every boundary, without clicks or key normalization", async () => {
		const text = paste(
			`a${click}${ESC}[27;5;13~${ESC}${ESC}[D${ESC}]10;rgb:aa/bb/cc\x07${ESC}[97;1:3u${ESC}[?1u\x9bIb`,
		);
		for (let i = 1; i < text.length; i++) {
			expect(await collect([text.slice(0, i), text.slice(i)])).toEqual({
				text,
				mouse: [],
			});
		}
		expect(await collect([...text])).toEqual({ text, mouse: [] });
	});

	it.each([
		["modifyOtherKeys Shift+Enter", `${ESC}[27;2;13~`, `${ESC}[13;2u`],
		["modifyOtherKeys Alt+Enter", `${ESC}[27;3;13~`, `${ESC}[13;3u`],
		["modifyOtherKeys Ctrl+Enter", `${ESC}[27;5;13~`, `${ESC}[13;5u`],
		["modifyOtherKeys Ctrl+letter", `${ESC}[27;5;97~`, `${ESC}[97;5u`],
		["escaped arrow", `${ESC}${ESC}[D`, `${ESC}[1;2D`],
		["encoded Alt arrow", `${ESC}[1;3D`, `${ESC}[1;3D`],
		["SS3 arrow", `${ESC}OD`, `${ESC}OD`],
		["modified SS3 arrow", `${ESC}O1;5D`, `${ESC}O1;5D`],
		["legacy function key", `${ESC}[[A`, `${ESC}[[A`],
		["rxvt shifted key", `${ESC}[3$`, `${ESC}[3$`],
		["Unicode CSI", "\x9b1;3D", `${ESC}[1;3D`],
	])(
		"normalizes only the individual %s",
		async (_name, sequence, normalized) => {
			for (let i = 1; i < sequence.length; i++) {
				expect(
					(await collect([sequence.slice(0, i), sequence.slice(i)])).text,
				).toBe(normalized);
			}
		},
	);

	it.each([
		["OSC BEL", `${ESC}]10;rgb:aa/bb/cc\x07`],
		["OSC ST", `${ESC}]52;c;YWJj${ESC}\\`],
		["DCS", `${ESC}P1+r544e=787465726d${ESC}\\`],
		["APC", `${ESC}_Gi=1;OK${ESC}\\`],
		["PM", `${ESC}^private${ESC}\\`],
		["SOS", `${ESC}Xpayload${ESC}\\`],
		["Unicode OSC/ST", "\x9d10;rgb:aa/bb/cc\x9c"],
		["X10 mouse", `${ESC}[M !!`],
		["Kitty letter release", `${ESC}[97;1:3u`],
		["Kitty default-modifier release", `${ESC}[97;:3u`],
		["Kitty alternate-key release", `${ESC}[97::65;1:3;97u`],
		["Kitty clear release", `${ESC}[1;1:3E`],
		["Kitty arrow release", `${ESC}[1;2:3D`],
		["Kitty delete release", `${ESC}[3;1:3~`],
	])("consumes %s outside paste at every boundary", async (_name, sequence) => {
		for (let i = 1; i < sequence.length; i++) {
			expect(
				(await collect([`a${sequence.slice(0, i)}`, `${sequence.slice(i)}b`]))
					.text,
			).toBe("ab");
		}
		expect((await collect([paste(sequence)])).text).toBe(paste(sequence));
	});

	it("frames legacy X10 coordinates as bytes rather than UTF-8 text", async () => {
		for (const coordinates of [
			[32, 0xc2, 0xa9],
			[32, 250, 0xc2],
			[32, 0x9b, 0xff],
		]) {
			const bytes = Buffer.concat([
				Buffer.from(`${ESC}[M`),
				Buffer.from(coordinates),
				Buffer.from("é!"),
			]);
			for (let i = 1; i < bytes.length; i++) {
				expect(
					(await collect([bytes.subarray(0, i), bytes.subarray(i)])).text,
				).toBe("é!");
			}
		}
	});

	it("normalizes C1 paste delimiters without confusing UTF-8 continuation bytes", async () => {
		const payload = "Л201~é👨‍👩‍👧‍👦";
		for (const bytes of [
			Buffer.from(`\x9b200~${payload}\x9b201~`),
			Buffer.concat([
				Buffer.from([0x9b]),
				Buffer.from(`200~${payload}`),
				Buffer.from([0x9b]),
				Buffer.from("201~"),
			]),
		]) {
			for (let i = 1; i < bytes.length; i++) {
				expect(
					(await collect([bytes.subarray(0, i), bytes.subarray(i)])).text,
				).toBe(paste(payload));
			}
		}
	});

	it("discards malformed SS3 and oversized CSI frames, then resumes at the next key", async () => {
		expect((await collect([`${ESC}O D!`])).text).toBe("!");
		const chunks = [
			`${ESC}[`,
			...Array.from({ length: 100 }, () => "123;".repeat(100)),
			"M",
			"hello",
		];
		expect((await collect(chunks)).text).toBe("hello");
		expect((await collect([`${ESC}[${"1".repeat(2000)}${ESC}[D!`])).text).toBe(
			`${ESC}[D!`,
		);
	});

	it("accepts source streams already emitting decoded strings", async () => {
		const source = new PassThrough();
		source.setEncoding("utf8");
		const output = StdinUtils.filter(source);
		const chunks: string[] = [];
		output.on("data", (chunk: string) => chunks.push(chunk));
		const ended = once(output, "end");
		for (const byte of Buffer.from("é🙂")) source.write(Buffer.from([byte]));
		source.end();
		await ended;
		expect(chunks.join("")).toBe("é🙂");
	});

	it("drops a cancelled CSI without losing the following key", async () => {
		expect((await collect([`${ESC}[123${ESC}[D!`])).text).toBe(`${ESC}[D!`);
		expect((await collect(["a\x81b"])).text).toBe("ab");
	});

	it("never flushes partial reports as text on a slow stream", async () => {
		const screen = await probe();
		screen.stdin.write(`${ESC}[<0;`);
		// Deliberately outwait ambiguity timers before completing the report.
		await settle();
		screen.stdin.write("10;20M");
		await screen.idle();
		expect(screen.mouse).toHaveLength(1);
		expect(screen.keys).toEqual([]);
		screen.cleanup();
	});
});

describe("installed Ink 8 integration", () => {
	it("keeps mouse, keys and paste on separate channels", async () => {
		const screen = await probe();
		const payload = `text${click}${ESC}[?1u${ESC}]10;rgb:aa/bb/cc\x07`;
		for (const char of `${click}${paste(payload)}${ESC}[D`)
			screen.stdin.write(char);
		await screen.idle();
		expect(screen.mouse).toHaveLength(1);
		expect(screen.pastes).toEqual([payload]);
		expect(screen.keys).toHaveLength(1);
		expect(screen.keys[0].key.leftArrow).toBe(true);
		screen.cleanup();
	});

	it("lets Ink handle CSI/SS3/Kitty keys but not terminal replies", async () => {
		const screen = await probe();
		screen.stdin.write(
			`${ESC}[I${ESC}[O${ESC}[12;34R${ESC}[?1;2c${ESC}[>0;276;0c${ESC}[?1u`,
		);
		await screen.idle();
		expect(screen.keys).toEqual([]);
		screen.stdin.write(
			`${ESC}[27;5;13~${ESC}OD${ESC}[1;3D${ESC}${ESC}[D${ESC}[D${ESC}[97;1:1u${ESC}[97;1:2u${ESC}[97;1:3u`,
		);
		await screen.idle();
		expect(
			screen.keys.map(({ input, key }) => ({
				input,
				left: key.leftArrow,
				shift: key.shift,
				meta: key.meta,
				ctrl: key.ctrl,
				enter: key.return,
			})),
		).toEqual([
			{
				input: "\r",
				left: false,
				shift: false,
				meta: false,
				ctrl: true,
				enter: true,
			},
			{
				input: "",
				left: true,
				shift: false,
				meta: false,
				ctrl: false,
				enter: false,
			},
			{
				input: "",
				left: true,
				shift: false,
				meta: true,
				ctrl: false,
				enter: false,
			},
			{
				input: "",
				left: true,
				shift: true,
				meta: false,
				ctrl: false,
				enter: false,
			},
			{
				input: "",
				left: true,
				shift: false,
				meta: false,
				ctrl: false,
				enter: false,
			},
			{
				input: "a",
				left: false,
				shift: false,
				meta: false,
				ctrl: false,
				enter: false,
			},
			{
				input: "a",
				left: false,
				shift: false,
				meta: false,
				ctrl: false,
				enter: false,
			},
		]);
		screen.cleanup();
	});

	it.each([0, 100])(
		"delivers standalone Escape, Emacs Alt keys and repeated backspace after a %i ms event-loop stall",
		async (stall) => {
			const screen = await probe();
			screen.stdin.write(ESC);
			const delivered = vi.waitFor(() =>
				expect(screen.keys[0]?.key.escape).toBe(true),
			);
			// Reproduce a busy CI runner: the outer wait can become due before
			// Ink even gets to schedule its second Escape ambiguity timer.
			if (stall)
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stall);
			await delivered;
			screen.stdin.write(`${ESC}b\x7f\x7f`);
			await screen.idle();
			expect(screen.keys[1]).toMatchObject({ input: "b", key: { meta: true } });
			expect(screen.keys.slice(2).every(({ key }) => key.backspace)).toBe(true);
			expect(screen.keys).toHaveLength(4);
			screen.cleanup();
		},
	);
});

describe("stream ownership", () => {
	it("forwards TTY methods with live raw state and detaches without closing the source", () => {
		const source = createTestInput();
		const baseline = source.listenerCount("data");
		const ref = vi.spyOn(source, "ref");
		const unref = vi.spyOn(source, "unref");
		const output = StdinUtils.filter(source) as unknown as NodeJS.ReadStream;
		expect(output.isTTY).toBe(true);
		output.setRawMode(true);
		expect(output.isRaw).toBe(true);
		output.setRawMode(false);
		expect(output.isRaw).toBe(false);
		output.ref();
		output.unref();
		expect(ref).toHaveBeenCalledTimes(1);
		expect(unref).toHaveBeenCalledTimes(1);
		output.destroy();
		expect(source.listenerCount("data")).toBe(baseline);
		expect(source.listenerCount("error")).toBe(0);
		expect(source.listenerCount("close")).toBe(0);
		expect(source.destroyed).toBe(false);
		source.destroy();
	});

	it("does not pretend a non-TTY stream supports raw mode", async () => {
		const source = new PassThrough();
		const output = StdinUtils.filter(source);
		expect("setRawMode" in output).toBe(false);
		const closed = once(output, "close");
		const errors: Error[] = [];
		output.on("error", (error) => errors.push(error));
		const error = new Error("terminal disconnected");
		// once(close) rejects on error, so observe the propagated failure too.
		const rejected = expect(closed).rejects.toBe(error);
		source.emit("error", error);
		await rejected;
		expect(errors).toEqual([error]);
		expect(source.destroyed).toBe(false);
		source.destroy();
	});

	it("clears partial framing when raw input ownership changes", async () => {
		for (const partial of [
			`${ESC}[<0;`,
			`${ESC}]10;rgb:`,
			`${ESC}[200~unfinished`,
		]) {
			const source = createTestInput();
			const output = StdinUtils.filter(source) as unknown as NodeJS.ReadStream;
			const chunks: string[] = [];
			output.on("data", (chunk: string) => chunks.push(chunk));
			output.setRawMode(true);
			source.write(partial);
			output.setRawMode(false);
			output.setRawMode(true);
			chunks.length = 0;
			source.write("next");
			await vi.waitFor(() => expect(chunks.join("")).toBe("next"));
			output.destroy();
			source.destroy();
		}
	});

	it("discards already-buffered keys when a paused reader changes ownership", async () => {
		const source = createTestInput();
		const output = StdinUtils.filter(source) as unknown as NodeJS.ReadStream;
		output.setRawMode(true);
		source.write("old\r");
		await vi.waitFor(() => expect(output.readableLength).toBeGreaterThan(0));
		output.setRawMode(false);
		output.setRawMode(true);
		expect(output.read()).toBeNull();
		source.write("new");
		await vi.waitFor(() => expect(output.readableLength).toBe(3));
		expect(output.read()).toBe("new");
		output.destroy();
		source.destroy();
	});

	it("ends on a closed source and cancels pending escape timers on destroy", async () => {
		const source = new PassThrough();
		const output = StdinUtils.filter(source);
		output.resume();
		const ended = once(output, "end");
		source.destroy();
		await ended;
		const another = new PassThrough();
		const filtered = StdinUtils.filter(another);
		const data = vi.fn();
		filtered.on("data", data);
		another.write(ESC);
		filtered.destroy();
		await settle();
		expect(data).not.toHaveBeenCalled();
		another.destroy();
	});

	it("forwards EOF and honors backpressure", async () => {
		const source = new PassThrough({ highWaterMark: 16 });
		const output = StdinUtils.filter(source);
		const text = "x".repeat(256 * 1024);
		let writes = 0;
		while (writes++ < 10 && source.write(text)) {
			/* Fill the stalled pipeline. */
		}
		expect(writes).toBeLessThan(10);
		const chunks: string[] = [];
		output.on("data", (chunk: string) => chunks.push(chunk));
		const ended = once(output, "end");
		source.end();
		await ended;
		expect(chunks.join("")).toBe(text.repeat(writes));
	});
});
