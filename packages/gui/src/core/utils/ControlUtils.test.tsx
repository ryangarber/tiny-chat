import type { ClientRuntime } from "#gui/core/types/runtime.ts";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";
import { act, render } from "#gui/tests.ts";

describe("export and editor controls", () => {
	it.each([
		{ shiftKey: false, isComposing: false, saved: true },
		{ shiftKey: true, isComposing: false, saved: false },
		{ shiftKey: false, isComposing: true, saved: false },
	])(
		"handles Enter with Shift=$shiftKey and composition=$isComposing",
		async ({ shiftKey, isComposing, saved }) => {
			const save = vi.fn();
			await render(
				<textarea aria-label="Title" onKeyDown={ControlUtils.onEnter(save)} />,
			);
			const editor = document.querySelector("textarea");
			if (!editor) throw new Error("missing editor");
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				shiftKey,
				isComposing,
			});
			await act(() => {
				editor.dispatchEvent(event);
			});
			expect(save).toHaveBeenCalledTimes(saved ? 1 : 0);
			expect(event.defaultPrevented).toBe(saved);
		},
	);

	it("prepends a UTF-8 BOM to Unicode CSV exports", async () => {
		const data = "city,name\n東京,Zoë";
		const blob = ControlUtils.preprocess({
			data,
			mime: "text/csv;charset=utf-8",
		});
		expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([
			0xef, 0xbb, 0xbf,
		]);
		expect(await blob.text()).toBe(data);
	});

	it("preserves binary blobs and does not add a BOM to other text formats", async () => {
		const data = new Blob([new Uint8Array([0, 128, 255])], {
			type: "application/octet-stream",
		});
		expect(ControlUtils.preprocess({ data, mime: data.type })).toBe(data);
		const text = ControlUtils.preprocess({ data: "東京", mime: "text/plain" });
		expect([...new Uint8Array(await text.arrayBuffer())]).toEqual([
			...new TextEncoder().encode("東京"),
		]);
	});

	it("passes a prepared blob to the host clipboard capability", async () => {
		const copy = vi.fn<NonNullable<ClientRuntime["copy"]>>(async () => {});
		await ControlUtils.copy({
			runtime: { platform: "web", copy, open: async () => {} },
			mime: "text/csv",
			data: "α,β",
		});
		expect(copy).toHaveBeenCalledOnce();
		const written = copy.mock.calls[0];
		expect(written[0].mime).toBe("text/csv");
		expect(await written[0].data.text()).toBe("α,β");
	});

	it("rasterizes SVG with the requested size and preserves transparency", async () => {
		const blob = await ControlUtils.rasterize(
			'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="6" height="8" fill="red"/></svg>',
			{ scale: 2 },
		);
		expect(blob.type).toBe("image/png");
		const bitmap = await createImageBitmap(blob);
		try {
			expect([bitmap.width, bitmap.height]).toEqual([24, 16]);
			const canvas = document.createElement("canvas");
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("missing canvas");
			context.drawImage(bitmap, 0, 0);
			expect([...context.getImageData(2, 2, 1, 1).data]).toEqual([
				255, 0, 0, 255,
			]);
			expect(context.getImageData(22, 2, 1, 1).data[3]).toBe(0);
		} finally {
			bitmap.close();
		}
	});

	it("reports invalid SVG exports instead of leaving the promise pending", async () => {
		await expect(ControlUtils.rasterize("not an SVG")).rejects.toThrow(
			"Failed to load SVG image",
		);
	});
});
