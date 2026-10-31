import { stripVTControlCharacters } from "node:util";
import ToolBlock from "#tui/features/part/components/ToolBlock.tsx";
import render from "#tui/tests.ts";

const block = {
	type: "web" as const,
	source: {
		url: "https://example.com/article",
		title: "Example article",
		content: "First paragraph.\n\nSecond paragraph with **emphasis**.",
	},
};

describe("web tool content", () => {
	it("shows the title, URL and full Markdown in copyable Content", async () => {
		const screen = await render(<ToolBlock block={block} active={false} />);
		try {
			const frame = stripVTControlCharacters(screen.lastFrame() ?? "");
			expect(frame).toContain(block.source.title);
			expect(frame).toContain(block.source.url);
			expect(frame).toContain("First paragraph.");
			expect(frame).toContain("Second paragraph with emphasis.");
			expect(frame).not.toContain("**emphasis**");
			expect(frame).toContain("copy");
			expect(frame.indexOf(block.source.url)).toBeLessThan(
				frame.indexOf("First paragraph."),
			);
		} finally {
			screen.unmount();
			screen.cleanup();
		}
	});

	it("does not offer copying while the content is active", async () => {
		const screen = await render(<ToolBlock block={block} active />);
		try {
			expect(screen.lastFrame()).toContain(block.source.title);
			expect(screen.lastFrame()).not.toContain("copy");
		} finally {
			screen.unmount();
			screen.cleanup();
		}
	});
});

describe("file tool content", () => {
	it("labels code blocks with their title", async () => {
		const screen = await render(
			<ToolBlock
				block={{ type: "code", value: "ls", language: "bash", title: "output" }}
				active={false}
			/>,
		);
		try {
			expect(stripVTControlCharacters(screen.lastFrame() ?? "")).toContain(
				"output",
			);
		} finally {
			screen.unmount();
			screen.cleanup();
		}
	});

	it("shows a document's extracted text", async () => {
		const screen = await render(
			<ToolBlock
				block={{
					type: "file",
					path: "/docs/tiny.pdf",
					// A one-page PDF reading "Tiny PDF text".
					document: {
						data: "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMTAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0MyA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDEwIDUwIFRkIChUaW55IFBERiB0ZXh0KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMzNCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQwNAolJUVPRgo=",
						mime: "application/pdf",
					},
					language: "markdown",
				}}
				active={false}
			/>,
		);
		try {
			await vi.waitFor(
				() =>
					expect(stripVTControlCharacters(screen.lastFrame() ?? "")).toContain(
						"Tiny PDF text",
					),
				{ timeout: 15_000 },
			);
			expect(screen.lastFrame()).toContain("/docs/tiny.pdf");
		} finally {
			screen.unmount();
			screen.cleanup();
		}
	});
});
